import Docker from "dockerode";
import { watch } from "./main";

const client = new Docker();

watch(client);

