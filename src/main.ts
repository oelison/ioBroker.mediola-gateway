/*
 * Created with @iobroker/create-adapter v2.3.0
 */

import * as utils from "@iobroker/adapter-core";
import axios from "axios";
import * as dgram from "dgram";
const inSocket = dgram.createSocket("udp4");
const outSocket = dgram.createSocket("udp4");
let waitingForAnyDevice = false;
let waitingForMacDevice = false;
let waitingForIpDevice = false;
let foundMacAddress = "";
let foundIpAddress = "";
let validMediolaFound = false;

// links of interest:
// https://github.com/ioBroker/AdapterRequests/issues/47 (main adapter request)
// https://github.com/ioBroker/AdapterRequests/issues/492 (868MHz request)
// https://github.com/ioBroker/AdapterRequests/issues/60

type MediolaEvt = { type: string; data: string };
function isMediolaEvt(o: any): o is MediolaEvt {
    return "type" in o && "data" in o;
}

// Load your modules here, e.g.:
// import * as fs from "fs";

class MediolaGateway extends utils.Adapter {
    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: "mediola-gateway",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        // Reset the connection indicator during startup
        this.setState("info.connection", false, true);

        // try to find the mediola gateway with the given config
        this.log.info("auto detection: " + this.config.autoDetect);
        if (this.config.autoDetect == false) {
            this.log.info("find by mac: " + this.config.findByMac);
            if (this.config.findByMac == true) {
                waitingForMacDevice = true;
                foundMacAddress = this.config.mac;
                this.log.info("with mac address: " + foundMacAddress);
            } else {
                this.log.info("find by ip: " + this.config.findByIp);
                if (this.config.findByIp == true) {
                    waitingForIpDevice = true;
                    foundIpAddress = this.config.ip;
                    this.log.info("with ip: " + foundIpAddress);
                } else {
                    this.log.error("no valid detection method defined");
                }
            }
        } else {
            waitingForAnyDevice = true;
        }
        inSocket.on("listening", () => {
            const address = inSocket.address();
            this.log.debug(`UDP socket listening on ${address.address}:${address.port}`);
        });
        inSocket.on("message", (message, remote) => {
            if (message.toString().startsWith("{XC_EVT}")) {
                const eventData = message.toString().substring(8);
                const jsonData = JSON.parse(eventData);
                if (isMediolaEvt(jsonData)) {
                    if (jsonData.type === "IR") {
                        this.setState("receivedIrData", { val: jsonData.data, ack: true });
                    }
                } else {
                    this.log.error("json format not known:" + message);
                }
            } else {
                this.log.debug(`in RECEIVED unknow message: ${remote.address}:${remote.port}-${message}|end`);
            }
        });
        inSocket.bind(1902);
        outSocket.bind(() => {
            outSocket.setBroadcast(true);
            outSocket.on("message", (message, remote) => {
                this.log.debug(`out RECEIVED: ${remote.address}:${remote.port} - ${message}|end`);
                const dataLines = String(message).split("\n");
                let ipAddress = "";
                let macAddress = "";
                let mediolaFound = false;
                for (const dataLine of dataLines) {
                    if (dataLine.startsWith("IP:")) {
                        ipAddress = dataLine.substring(3);
                    }
                    if (dataLine.startsWith("MAC:")) {
                        macAddress = dataLine.substring(4);
                        // possible command to set the DNS of the gateway
                        // outSocket.send(
                        //     'SET:' + macAddress + '\n' +
                        //     'AUTH:' + password + '\n' +
                        //     'DNS:192.168.54.99\n'
                        //     , 1901, '255.255.255.255', (err) => {
                        //         this.log.error(`err send pwd: ${err}`);
                        // });
                    }
                    if (dataLine.startsWith("NAME:AIO GATEWAY")) {
                        mediolaFound = true;
                    }
                }
                if (mediolaFound) {
                    if (waitingForAnyDevice === true) {
                        waitingForAnyDevice = false;
                        foundMacAddress = macAddress;
                        foundIpAddress = ipAddress;
                        this.setState("info.connection", true, true);
                        this.log.info(`Mediola connected with ip:${ipAddress} and mac:${macAddress}`);
                        validMediolaFound = true;
                    }
                    if (waitingForMacDevice === true) {
                        if (foundMacAddress === macAddress) {
                            waitingForMacDevice = false;
                            foundIpAddress = ipAddress;
                            this.setState("info.connection", true, true);
                            this.log.info(`Mediola connected with ip:${ipAddress} and mac:${macAddress}`);
                            validMediolaFound = true;
                        }
                    }
                    if (waitingForIpDevice === true) {
                        if (foundIpAddress === ipAddress) {
                            waitingForIpDevice = false;
                            foundMacAddress = macAddress;
                            this.setState("info.connection", true, true);
                            this.log.info(`Mediola connected with ip:${ipAddress} and mac:${macAddress}`);
                            validMediolaFound = true;
                        }
                    }
                } else {
                    this.log.error("unkown device on this port");
                }
            });
        });
        outSocket.send("GET\n", 1901, "255.255.255.255", (err) => {
            console.log("err send: " + err);
        });
        // setup the connectors
        await this.setObjectNotExistsAsync("receivedIrData", {
            type: "state",
            common: {
                name: "receivedIrData",
                type: "string",
                role: "text",
                read: true,
                write: false,
            },
            native: {},
        });
        await this.setObjectNotExistsAsync("sendIrData", {
            type: "state",
            common: {
                name: "sendIrData",
                type: "string",
                role: "text",
                read: true,
                write: true,
            },
            native: {},
        });
        this.subscribeStates("sendIrData");
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     */
    private onUnload(callback: () => void): void {
        try {
            inSocket.close();
            outSocket.close();
            callback();
        } catch (e) {
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     */
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (state) {
            // The state was changed
            this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
            if (id.endsWith("sendIrData")) {
                this.log.debug("try send: " + state.val);
                if (validMediolaFound) {
                    let reqUrl = "http://" + foundIpAddress + "/command?XC_FNC=Send2&code=" + state.val;
                    reqUrl = encodeURI(reqUrl);
                    this.log.debug("url request to mediola: " + reqUrl);
                    axios
                        .get(reqUrl)
                        .then((res) => {
                            this.log.debug(res.data);
                            if (res.data != "{XC_SUC}") {
                                this.log.error("mediola device rejected the command: " + state.val);
                            }
                        })
                        .catch((error) => {
                            this.log.debug(error);
                        });
                }
            }
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new MediolaGateway(options);
} else {
    // otherwise start the instance directly
    (() => new MediolaGateway())();
}
