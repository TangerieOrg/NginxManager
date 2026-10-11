import Docker from "dockerode";
import path from "path";
import fs from "fs";
import { ServiceConfig } from "./types";

const NETWORK_NAME = "nginx-proxy-overlay";
const OUTPUT_PATH = path.join(__dirname, "..", "outputs", "generated.conf");
// Must not end in .conf or nginx will include it
const TMP_PATH = path.join(__dirname, "..", "outputs", ".generated.tmp");
const NGINX_LABEL = "xyz.tangerie.nginx_manager.role=nginx";
const DEBOUNCE_MS = 2000;
const RESYNC_MS = 60 * 1000;

async function getNetworkId(client : Docker) {
    for(const network of await client.listNetworks({})) {
        if(network.Name === NETWORK_NAME) return network.Id;
    }
}

const isServiceOnNetwork = (service : Docker.Service, networkId : string) => {
    const { Spec } = service;
    if(!Spec || !Spec.TaskTemplate || !Spec.TaskTemplate.Networks) return false;

    return Spec.TaskTemplate.Networks.filter(({ Target }) => Target === networkId).length > 0;
}

const ConfigKeys = [
    "xyz.tangerie.reverse_proxy.path",
    "xyz.tangerie.reverse_proxy.port"
];

const doesServiceHaveKeys = (service : Docker.Service) => {
    if(!service.Spec?.Labels) return false;
    for(const key of ConfigKeys) if(!service.Spec.Labels[key]) return false;
    return true;
}

async function getServices(client : Docker, networkId : string) {
    return (await client.listServices().catch(() => []))
        .filter(service => {
            if(!isServiceOnNetwork(service, networkId)) return false;
            return doesServiceHaveKeys(service);
        })
        // Sort for stability in results
        .sort((a, b) => (a.Spec!.Name! > b.Spec!.Name!) ? 1 : -1)
}

const doesContainerHaveKeys = (service : Docker.ContainerInfo) => {
    if(!service.Labels) return false;
    for(const key of ConfigKeys) if(!service.Labels[key]) return false;
    if(service.Names.length == 0) return false;
    return true;
}

async function getContainers(client : Docker, networkId : string) {
    return (await client.listContainers({ filters: { network: [networkId] } }).catch(() => []))
        .filter(contaienr => {
            return doesContainerHaveKeys(contaienr);
        })
        // Sort for stability in results
        .sort((a, b) => (a.Names[0] > b.Names[0]) ? 1 : -1)

}

const getServiceConfig = (service : Docker.Service) : ServiceConfig => {
    const hostname = service.Spec!.Name!;
    const path = service.Spec!.Labels!["xyz.tangerie.reverse_proxy.path"].replace(/\/+$/, "");
    const port = service.Spec!.Labels!["xyz.tangerie.reverse_proxy.port"];
    const server_name = service.Spec!.Labels!["xyz.tangerie.reverse_proxy.server_name"] ?? "";
    const no_trailing_slash = (service.Spec!.Labels!["xyz.tangerie.reverse_proxy.no_trailing_slash"] ?? "") == "true";

    return {
        hostname,
        path,
        port,
        server_name,
        no_trailing_slash
    }
}

const getContainerConfig = (container : Docker.ContainerInfo) : ServiceConfig => {
    const hostname = container.Names.at(0)!.replace("/", "");
    const path = container.Labels!["xyz.tangerie.reverse_proxy.path"].replace(/\/+$/, "");
    const port = container.Labels!["xyz.tangerie.reverse_proxy.port"];
    const server_name = container.Labels!["xyz.tangerie.reverse_proxy.server_name"] ?? "";
    const no_trailing_slash = (container.Labels!["xyz.tangerie.reverse_proxy.no_trailing_slash"] ?? "") == "true";

    return {
        hostname,
        path,
        port,
        server_name,
        no_trailing_slash
    }
}

const getConfigsByServerName = (services : Docker.Service[], containers : Docker.ContainerInfo[]) => {
    const servers : Record<string, ServiceConfig[]> = {};

    for(const service of services) {
        const cfg = getServiceConfig(service);
        if(!servers[cfg.server_name]) servers[cfg.server_name] = [cfg];
        else servers[cfg.server_name].push(cfg)
    }
    for(const container of containers) {
        const cfg = getContainerConfig(container);
        if(!servers[cfg.server_name]) servers[cfg.server_name] = [cfg];
        else servers[cfg.server_name].push(cfg)
    }

    return servers;
}

// proxy_pass uses a variable so nginx resolves at request time, which means the prefix has to be stripped by hand
const createLocation = ({ hostname, path, port, no_trailing_slash } : ServiceConfig) => {
    const prefix = path === "" ? "" : "^~";
    const rewrite = path === "" || no_trailing_slash ? "" : `rewrite "^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(/.*)$" $1 break;`;

    return `location ${prefix} ${path}/ {
        include /etc/nginx/snippets/proxy_header.conf;
        set $upstream ${hostname}:${port};
        ${rewrite}
        proxy_pass http://$upstream;
    }
`;
}

const createServer = (name : string, cfgs : ServiceConfig[]) => {
    return `server {
    listen 80${name.length === 0 ? " default_server" : ""};
    listen [::]:80${name.length === 0 ? " default_server" : ""};
    include /etc/nginx/snippets/server_base.conf;
    ${name.length === 0 ? "" : `server_name ${name};`}

    ${cfgs.map(createLocation).join("\n")}
}
`;
}

const readExisting = () => {
    if(!fs.existsSync(OUTPUT_PATH)) return undefined;
    return fs.readFileSync(OUTPUT_PATH, {
        encoding: "utf-8"
    });
}

const write = (config : string | undefined) => {
    if(config === undefined) return fs.rmSync(OUTPUT_PATH, { force: true });
    fs.writeFileSync(TMP_PATH, config, {
        encoding: "utf-8"
    });
    fs.renameSync(TMP_PATH, OUTPUT_PATH);
}

const reload = async (client : Docker, containers : Docker.ContainerInfo[]) => {
    let ok = true;

    for(const info of containers) {
        const exec = await client.getContainer(info.Id).exec({
            Cmd: ["sh", "-c", "nginx -t && nginx -s reload"],
            AttachStdout: true,
            AttachStderr: true,
            Tty: true
        });
        const stream = await exec.start({ Tty: true });

        const output = await new Promise<string>(resolve => {
            let out = "";
            stream.on("data", (x : Buffer) => out += x.toString());
            stream.on("end", () => resolve(out));
        });

        const { ExitCode } = await exec.inspect();
        if(ExitCode !== 0) {
            console.error(output);
            ok = false;
        }
    }

    return ok;
}

let lastBad = "";

export const run = async (client : Docker) => {
    const networkId = await getNetworkId(client);
    if(!networkId) {
        console.error("Failed to find network");
        return;
    }
    const services = await getServices(client, networkId);
    const containers = await getContainers(client, networkId);
    const servers = getConfigsByServerName(services, containers);

    let config = "";

    // Do default server first
    if(servers[""]) {
        config += createServer("", servers[""]);
        delete servers[""];
    }

    for(const server_name in servers) {
        config += createServer(server_name, servers[server_name]);
    }

    const nginx = await client.listContainers({ filters: { label: [NGINX_LABEL] } });
    // Retry a bad config if the nginx containers change, they might be running different snippets
    const key = config + nginx.map(x => x.Id).join(",");

    const existing = readExisting();
    if(existing === config || lastBad === key) return;

    console.log("Docker Update Detected");
    console.log(config);
    write(config);

    if(await reload(client, nginx)) {
        lastBad = "";
        return;
    }

    console.error("Reload failed, restoring previous config");
    lastBad = key;
    write(existing);
    await reload(client, nginx);
}

export const watch = async (client : Docker) => {
    let timeout : NodeJS.Timeout | undefined;
    let isRunning = false;
    let isQueued = false;

    const sync = async () => {
        if(isRunning) {
            isQueued = true;
            return;
        }
        isRunning = true;
        await run(client).catch(err => console.error(err));
        isRunning = false;
        if(isQueued) {
            isQueued = false;
            schedule();
        }
    }

    const schedule = () => {
        clearTimeout(timeout);
        timeout = setTimeout(sync, DEBOUNCE_MS);
    }

    const listen = async () => {
        const stream = await client.getEvents({
            filters: {
                type: ["service", "container", "network"],
                event: ["create", "update", "remove", "start", "die", "destroy", "connect", "disconnect"]
            }
        }).catch(err => console.error(err));

        if(!stream) {
            setTimeout(listen, 5000);
            return;
        }

        let isClosed = false;
        const reconnect = () => {
            if(isClosed) return;
            isClosed = true;
            console.log("Event stream closed, reconnecting");
            setTimeout(listen, 5000);
        }

        stream.on("data", () => schedule());
        stream.on("end", reconnect);
        stream.on("close", reconnect);
        stream.on("error", reconnect);
    }

    await sync();
    listen();
    setInterval(schedule, RESYNC_MS);
}
