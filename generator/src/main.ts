import Docker from "dockerode";
import path from "path";
import fs from "fs";
import { ServiceConfig } from "types";

const NETWORK_NAME = "nginx-proxy-overlay";
const OUTPUT_PATH = path.join(__dirname, "..", "outputs", "generated.conf");
const SIGNAL_PATH = path.join(__dirname, "..", "outputs", "signal");

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
    return (await client.listContainers({ network: networkId }).catch(() => []))
        .filter(contaienr => {
            return doesContainerHaveKeys(contaienr);
        })
        // Sort for stability in results
        .sort((a, b) => (a.Names[0] > b.Names[0]) ? 1 : -1)

}

const getServiceConfig = (service : Docker.Service) : ServiceConfig => {
    const hostname = service.Spec!.Name!;
    let path = service.Spec!.Labels!["xyz.tangerie.reverse_proxy.path"];
    if(path === '/') path = '';
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
    let path = container.Labels!["xyz.tangerie.reverse_proxy.path"];
    if(path === '/') path = '';
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

const createLocation = ({ hostname, path, port, no_trailing_slash } : ServiceConfig) => {
    const prefix = path === "" ? "" : "^~";

    return `location ${prefix} ${path}/ {
        include /etc/nginx/snippets/proxy_header.conf;
        proxy_pass http://${hostname}:${port}${no_trailing_slash ? "" : "/"};
    }
`;
}

const createServer = (name : string, cfgs : ServiceConfig[]) => {
    return `server {
    include /etc/nginx/snippets/server_base.conf;
    ${name.length === 0 ? "" : `server_name ${name};`}

    ${cfgs.map(createLocation).join("\n")}
}
`;
}

const doUpdate = (config : string) => {
    if(!fs.existsSync(OUTPUT_PATH)) return true;
    const existing = fs.readFileSync(OUTPUT_PATH, {
        encoding: 'utf-8'
    });

    return existing !== config;
}

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

    if(doUpdate(config)) {
        console.log("Docker Update Detected");
        console.log(config);
        fs.writeFileSync(OUTPUT_PATH, config, {
            encoding: 'utf-8'
        });
        fs.writeFileSync(SIGNAL_PATH, "");
    }
}