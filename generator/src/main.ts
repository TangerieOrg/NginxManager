import Docker from "dockerode";
import path from "path";
import fs from "fs";

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
    return (await client.listServices())
        .filter(service => {
            if(!isServiceOnNetwork(service, networkId)) return false;
            return doesServiceHaveKeys(service);
        })
        // Sort for stability in results
        .sort((a, b) => (a.Spec!.Name! > b.Spec!.Name!) ? 1 : -1)

}

const createConfigFromService = (service : Docker.Service) => {
    const hostname = service.Spec!.Name!;
    let path = service.Spec!.Labels!["xyz.tangerie.reverse_proxy.path"];
    if(path === '/') path = '';
    
    const port = service.Spec!.Labels!["xyz.tangerie.reverse_proxy.port"];

    const prefix = path === "" ? "" : "^~";

    return `location ${prefix} ${path}/ {
    include /etc/nginx/snippets/proxy_header.conf;
    proxy_pass http://${hostname}:${port}/;
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
    const config = services.map(createConfigFromService).join("\n");
    
    if(doUpdate(config)) {
        console.log("Docker Update Detected");
        console.log(config);
        fs.writeFileSync(OUTPUT_PATH, config, {
            encoding: 'utf-8'
        });
        fs.writeFileSync(SIGNAL_PATH, "");
    }
}