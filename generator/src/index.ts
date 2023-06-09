import Docker from "dockerode";
import { run } from "main";

const client = new Docker();

run(client);

