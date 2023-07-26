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
let sysvarInit = false;

// links of interest:
// https://github.com/ioBroker/AdapterRequests/issues/47 (main adapter request)
// https://github.com/ioBroker/AdapterRequests/issues/492 (868MHz request)
// https://github.com/ioBroker/AdapterRequests/issues/60
// https://github.com/ioBroker/AdapterRequests/issues/848 (WIR rolladen request)

type MediolaEvt = { type: string; data: string };
function isMediolaEvt(o: any): o is MediolaEvt {
    return "type" in o && "data" in o;
}
type MediolaSysVarArray = [{ type: string; adr: string; state: string }];
function isMediolaSysVarArray(o: any): o is MediolaSysVarArray {
    return true;
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
     * check for forbidden chars
     */
    private validName(Name: string): boolean {
        const CheckName = Name.replace(this.FORBIDDEN_CHARS, "_");
        if (CheckName == Name) {
            return true;
        } else {
            return false;
        }
    }
    /**
     * create URL
     */
    private genURL(): string {
        let retVal = "";
        if (this.config.username === "") {
            retVal = "http://" + foundIpAddress + "/command?";
        } else {
            retVal =
                "http://" +
                foundIpAddress +
                "/command?XC_USER=" +
                this.config.username +
                "&XC_PASS=" +
                this.config.password +
                "&";
        }
        return retVal;
    }
    /**
     * Is called when valid mediola found
     * read all existing SysVars
     */
    private async readAllSystemVars(): Promise<void> {
        if (validMediolaFound && !sysvarInit) {
            sysvarInit = true;
            let reqUrl = this.genURL() + "XC_FNC=getstates";
            reqUrl = encodeURI(reqUrl);
            axios
                .get(reqUrl)
                .then((res) => {
                    this.log.debug(res.data);
                    if (res.data.toString().startsWith("{XC_SUC}")) {
                        this.log.debug("mediola device found data: " + res.data);
                        try {
                            const jsonData = JSON.parse(res.data.substring(8));
                            if (isMediolaSysVarArray(jsonData)) {
                                if (jsonData.length > 0) {
                                    for (let index = 0; index < jsonData.length; index++) {
                                        const element = jsonData[index];
                                        this.log.debug(JSON.stringify(element));
                                        // element.adr is from 01 to ff, no invalid chars possible according specification
                                        // discard element, when not following the naming standart (just for sure)
                                        if (this.validName(element.adr)) {
                                            let objName = "";
                                            let description = "";
                                            let writable = false;
                                            let objState = "";
                                            if (element.type === "WR") {
                                                objName = element.type + element.adr;
                                                if (element.adr.length != 8) {
                                                    this.log.error("this WR element has not 8 chars: " + element.adr);
                                                }
                                                description = "WIR " + element.adr + " 1=up, 2=down, 3=stop";
                                                writable = true;
                                                objState = "0";
                                            } else if (element.type === "BK") {
                                                objName = element.type + element.adr;
                                                if (element.adr.length != 6) {
                                                    this.log.error("this BK element has not 6 chars: " + element.adr);
                                                }
                                                description = "Nobily " + element.adr;
                                                writable = true;
                                                objState = "0";
                                            } else {
                                                objName = "id" + element.adr;
                                                description = "sysvar" + element.adr;
                                                objState = element.state;
                                            }
                                            this.setObjectNotExists(objName, {
                                                type: "state",
                                                common: {
                                                    name: description,
                                                    type: "string",
                                                    role: "text",
                                                    read: true,
                                                    write: writable,
                                                },
                                                native: {},
                                            });
                                            this.setState(objName, { val: objState, ack: true });
                                        } else {
                                            this.log.error(
                                                "invalid sys var name from mediola device element.adr = " + element.adr,
                                            );
                                        }
                                    }
                                }
                            } else {
                                this.log.error("json format not known:" + res.data.substring(8));
                            }
                        } catch (error) {
                            this.log.error("json format invalid:" + res.data.substring(8));
                        }
                    } else {
                        this.log.error("mediola device rejected the request: " + res.data);
                    }
                })
                .catch((error) => {
                    sysvarInit = false; // retry next time
                    this.log.error("mediola device not reached by getting sys vars");
                    this.log.error(error);
                });
        }
    }
    // lern call
    // http://ipaddress/command?XC_FNC=Learn
    // set calls
    // http://ipaddress/command?XC_FNC=setVar&id=01&type=ONOFF&value=off
    // http://ipaddress/command?XC_FNC=setVar&id=01&type=ONOFF&value=on
    // http://ipaddress/command?XC_FNC=setVar&id=02&type=int&value=00000007
    // http://ipaddress/command?XC_FNC=setVar&id=03&type=float&value=31323334
    // http://ipaddress/command?XC_FNC=setVar&id=04&type=string&value=abcdefghij
    // events
    // {XC_EVT}{"type":"SV","data":"B:01:off"}
    // {XC_EVT}{"type":"SV","data":"B:01:on"}
    // {XC_EVT}{"type":"SV","data":"I:02:00000007"}
    // {XC_EVT}{"type":"SV","data":"F:03:432"}
    // {XC_EVT}{"type":"SV","data":"S:04:abcdefghij"}
    // getstates Mediola
    // http://ipaddress/command?XC_FNC=getstates
    // {XC_SUC}[
    //    {"type":"ONOFF","adr":"01","state":"on"},
    //    {"type":"INT","adr":"02","state":"00000007"},
    //    {"type":"FLOAT","adr":"03","state":"31323334"},
    //    {"type":"STRING","adr":"04","state":"abcdefghij"}]
    // getstates Nobily
    // {XC_SUC}[
    //    {"type":"BK","sid":"01","adr":"123456","config":"","state":""}]
    // getstates WIR
    // {XC_SUC}[
    //      {"type":"EVENT","adr":"FF","state":"0"},
    //      {"type":"WR","sid":"01","adr":"xaaaaaax","config":"F000050528:1:7340:6B53","state":"013300","deviceType":"01"}]
    // /info?at=46b385e0a2d610044569ff7a031324a9
    // {"XC_SUC":
    //  {   "name":"WIR-CONNECT V6",
    //      "mhv":"XN II",
    //      "mfv":"1.2.10-3896c366",
    //      "msv":"1.16.0",
    //      "hwv":"C3",
    //      "vid":"000A",
    //      "mem":200000,
    //      "ip":"xxx.xxx.xxx.xxx",
    //      "sn":"xxx.xxx.xxx.xxx",
    //      "gw":"xxx.xxx.xxx.xxx",
    //      "dns":"xxx.xxx.xxx.xxx",
    //      "mac":"40-66-7a-00-86-d4",
    //      "ntp":"xxx.xxx.xxx.xxx",
    //      "start":1680028537,
    //      "time":1689705023,
    //      "loc":"21020D0087",
    //      "serial":"230400,8N1",
    //      "io":"AA-E0",
    //      "cfg":"BF",
    //      "server":"ccs.wir-elektronik-cloud.de:80",
    //      "locked":false,
    //      "sid":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    //      "wifi":"HITCS_mobile",
    //      "rssi":-60}}
    // set rollo
    // /cmd?XC_FNC=SendSC&type=WR&data=01xaaaaaax0101&at=46b385e0a2d610044569ff7a031324a9 up
    // /cmd?XC_FNC=SendSC&type=WR&data=01xaaaaaax0102&at=46b385e0a2d610044569ff7a031324a9 down
    // /cmd?XC_FNC=SendSC&type=WR&data=01xaaaaaax0103&at=46b385e0a2d610044569ff7a031324a9 stop
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
                try {
                    const jsonData = JSON.parse(eventData);
                    if (isMediolaEvt(jsonData)) {
                        if (jsonData.type === "IR") {
                            this.setState("receivedIrData", { val: jsonData.data, ack: true });
                        } else if (jsonData.type === "SV") {
                            this.log.debug(JSON.stringify(jsonData));
                            const data = jsonData.data;
                            const index = data.substring(2, 4);
                            const value = data.substring(5);
                            if (data.startsWith("I:")) {
                                this.setState("id" + index, { val: value, ack: true });
                            } else if (data.startsWith("B:")) {
                                this.setState("id" + index, { val: value, ack: true });
                            } else if (data.startsWith("S:")) {
                                this.setState("id" + index, { val: value, ack: true });
                            } else if (data.startsWith("F:")) {
                                // never reached yet, because invalid json chars in floats
                                this.setState("id" + index, { val: value, ack: true });
                            } else {
                                this.log.debug("sys var type not known: " + jsonData.data);
                            }
                        } else if (jsonData.type === "WR") {
                            // not yet seen, but should be intresting when received
                            this.log.debug(JSON.stringify(jsonData));
                        } else if (jsonData.type === "HM") {
                            // ignor HM data
                        } else {
                            this.log.debug("data type not known: " + jsonData.type);
                            this.log.debug(JSON.stringify(jsonData));
                        }
                    } else {
                        this.log.error("json format not known:" + message);
                    }
                } catch (error) {
                    this.log.error("json format invalid:" + message);
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
                    this.log.debug(dataLine);
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
                    if (dataLine.startsWith("NAME:WIR-CONNECT V6")) {
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
                    if (validMediolaFound === true) {
                        this.readAllSystemVars();
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
        await this.setObjectNotExistsAsync("sendRfData", {
            type: "state",
            common: {
                name: "sendRfData",
                type: "string",
                role: "text",
                read: true,
                write: true,
            },
            native: {},
        });
        this.subscribeStates("sendIrData");
        this.subscribeStates("sendRfData");
        this.subscribeStates("id*");
        this.subscribeStates("WR*");
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
            this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
            // This is ioBroker convention, only send commands if ack = false
            if (state.ack === false) {
                const dataNameParts = id.split(".");
                let dataName = "";
                if (dataNameParts.length === 3) {
                    dataName = dataNameParts[2];
                }
                if (dataName === "sendIrData") {
                    this.log.debug("try send: " + state.val);
                    if (validMediolaFound) {
                        let reqUrl = this.genURL() + "XC_FNC=Send2&code=" + state.val;
                        reqUrl = encodeURI(reqUrl);
                        axios
                            .get(reqUrl)
                            .then((res) => {
                                this.log.debug(res.data);
                                if (res.data != "{XC_SUC}") {
                                    this.log.error("mediola device rejected the command: " + state.val);
                                }
                            })
                            .catch((error) => {
                                this.log.error("mediola device not reached by sending IR data");
                                this.log.error(error);
                            });
                    }
                } else if (dataName === "sendRfData") {
                    this.log.debug("try send: " + state.val);
                    if (validMediolaFound) {
                        let reqUrl = this.genURL() + "XC_FNC=Send2&ir=00&rf=01&code=" + state.val;
                        reqUrl = encodeURI(reqUrl);
                        axios
                            .get(reqUrl)
                            .then((res) => {
                                this.log.debug(res.data);
                                if (res.data != "{XC_SUC}") {
                                    this.log.error("mediola device rejected the command: " + state.val);
                                }
                            })
                            .catch((error) => {
                                this.log.error("mediola device not reached by sending rf data");
                                this.log.error(error);
                            });
                    }
                } else if (dataName.startsWith("id")) {
                    this.log.debug("got known event: " + id + " " + JSON.stringify(state));
                } else if (dataName.startsWith("WR")) {
                    const wrId = dataName.replace("WR", "");
                    let direction = "03"; // stop
                    if (state.val === "1") {
                        direction = "01";
                    } else if (state.val == 2) {
                        direction = "02";
                    } else if (state.val == 3) {
                        direction = "03";
                    } else {
                        this.log.error("only 1 (up), 2 (down) or 3 (stop) is allowed. For safety do a stop");
                    }
                    if (validMediolaFound) {
                        let reqUrl =
                            this.genURL() +
                            "XC_FNC=SendSC&type=WR&data=01" +
                            wrId +
                            "01" +
                            direction +
                            "&at=46b385e0a2d610044569ff7a031324a9";
                        reqUrl = encodeURI(reqUrl);
                        axios
                            .get(reqUrl)
                            .then((res) => {
                                this.log.debug(res.data);
                                const retVal: string = res.data.toString();
                                if (retVal.includes("XC_SUC") === false) {
                                    this.log.error(
                                        "mediola device rejectedx the command: " + state.val + " response: " + res.data,
                                    );
                                }
                            })
                            .catch((error) => {
                                this.log.error("mediola device not reached by sending SC data");
                                this.log.error(error);
                            });
                    }
                } else {
                    this.log.debug("got unknown event: " + JSON.stringify(state));
                }
            }
        } else {
            // The state was deleted
            this.log.debug(`state ${id} deleted`);
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
