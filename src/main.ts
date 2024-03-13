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
let pullDataTimer: ioBroker.Timeout | undefined | null = null;

type MediolaEvt = { type: string; data: string };
function isMediolaEvt(o: any): o is MediolaEvt {
    return "type" in o && "data" in o;
}
type MediolaSysVarArray = [
    {
        type: string;
        adr: string;
        state: string;
        id: number;
        active: boolean;
    },
];
type HmState = { lowbat: boolean; state: string };
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
        let commandType = "command";
        if (this.config.mediolaV5orHigher === true) {
            commandType = "cmd";
        }
        if (this.config.username === "") {
            if (this.config.auth === "") {
                retVal = "http://" + foundIpAddress + "/" + commandType + "?";
            } else {
                retVal = "http://" + foundIpAddress + "/" + commandType + "?auth=" + this.config.auth + "&";
            }
        } else {
            retVal =
                "http://" +
                foundIpAddress +
                "/" +
                commandType +
                "?XC_USER=" +
                this.config.username +
                "&XC_PASS=" +
                this.config.password +
                "&";
        }
        return retVal;
    }
    /** evaluate if the response data is successfull
     * it looks like that cmd returns a json and command a text
     * actual documentation of the API do not explain this
     * workaround to test both every time
     */
    private testResponse(response: axios.AxiosResponse): boolean {
        let successfull = false;
        try {
            if (response.data.toString().startsWith("{XC_SUC}")) {
                successfull = true;
            }
        } catch (error) {
            this.log.debug("response.data.toString failed");
        }
        try {
            if (JSON.stringify(response.data).startsWith('{"XC_SUC"')) {
                successfull = true;
            }
        } catch (error) {
            this.log.debug("JSON.stringify(response.data) failed");
        }
        if (successfull === false) {
            try {
                this.log.error("JSON response cmd: " + JSON.stringify(response.data));
            } catch (error) {
                this.log.debug("log error print failed json");
            }
            try {
                this.log.error("text response command: " + response.data.toString());
            } catch (error) {
                this.log.debug("log error print failed to string");
            }
        }
        return successfull;
    }
    /**
     * Is called when valid mediola found
     * read all existing SysVars
     */
    private async readAllSystemVars(timerRead: boolean): Promise<void> {
        this.log.debug(
            "validMediola: " +
                validMediolaFound +
                " sysvarInti: " +
                sysvarInit +
                " timerRead: " +
                timerRead +
                " cmd " +
                this.config.mediolaV5orHigher +
                " pull " +
                this.config.pullData,
        );
        if ((validMediolaFound && !sysvarInit) || timerRead) {
            sysvarInit = true;
            let reqUrl = this.genURL() + "XC_FNC=getstates";
            reqUrl = encodeURI(reqUrl);
            this.log.debug(reqUrl);
            axios
                .get(reqUrl)
                .then((res) => {
                    this.log.debug(JSON.stringify(res.data));
                    let jsonData = null;
                    let validJsonData = false;
                    if (res.data.toString().startsWith("{XC_SUC}")) {
                        jsonData = JSON.parse(res.data.substring(8));
                        validJsonData = true;
                    } else if (JSON.stringify(res.data).startsWith('{"XC_SUC":[')) {
                        jsonData = res.data.XC_SUC;
                        validJsonData = true;
                    } else {
                        jsonData = [];
                    }
                    if (validJsonData) {
                        //this.log.debug("mediola device found data: " + res.data);
                        try {
                            this.log.debug("mediola device found data: " + JSON.stringify(jsonData));
                            if (isMediolaSysVarArray(jsonData)) {
                                if (jsonData.length > 0) {
                                    for (let index = 0; index < jsonData.length; index++) {
                                        const element = jsonData[index];
                                        this.log.debug(JSON.stringify(element));
                                        // element.adr is from 01 to ff, no invalid chars possible according specification
                                        // discard element, when not following the naming standart (just for sure)
                                        if (element.type === "TASK") {
                                            const taskId = element.id;
                                            const taskActive = element.active;
                                            const objName = "TASK" + taskId;
                                            this.setObjectNotExists("state." + objName, {
                                                type: "state",
                                                common: {
                                                    name: "TASK " + taskId,
                                                    type: "boolean",
                                                    role: "text",
                                                    read: true,
                                                    write: false,
                                                },
                                                native: {},
                                            });
                                            this.setState("state." + objName, { val: taskActive, ack: true });
                                        } else if (this.validName(element.adr)) {
                                            let objState = "";
                                            if (element.type === "WR") {
                                                const objName = element.type + element.adr;
                                                if (element.adr.length != 8) {
                                                    this.log.error("this WR element has not 8 chars: " + element.adr);
                                                }
                                                this.setObjectNotExists("state." + objName, {
                                                    type: "state",
                                                    common: {
                                                        name: "WIR " + element.adr,
                                                        type: "number",
                                                        role: "text",
                                                        read: true,
                                                        write: false,
                                                    },
                                                    native: {},
                                                });
                                                this.setObjectNotExists("action." + objName, {
                                                    type: "state",
                                                    common: {
                                                        name: "WIR " + element.adr + " 1=up, 2=down, 3=stop",
                                                        type: "string",
                                                        role: "text",
                                                        read: true,
                                                        write: true,
                                                    },
                                                    native: {},
                                                });
                                                if (element.state.length === 6) {
                                                    const hexVal = element.state.substring(2, 4);
                                                    const dezVal = parseInt(hexVal, 16);
                                                    this.setState("state." + objName, { val: dezVal, ack: true });
                                                } else {
                                                    this.log.error(
                                                        "state length not 6 element.state: " + element.state,
                                                    );
                                                    this.setState("state." + objName, { val: 0, ack: true });
                                                }
                                            } else if (element.type === "BK") {
                                                const objName = element.type + element.adr;
                                                if (element.adr.length != 6) {
                                                    this.log.error("this BK element has not 6 chars: " + element.adr);
                                                }
                                                this.setObjectNotExists("state." + objName, {
                                                    type: "state",
                                                    common: {
                                                        name: "BK " + element.adr,
                                                        type: "string",
                                                        role: "text",
                                                        read: true,
                                                        write: false,
                                                    },
                                                    native: {},
                                                });
                                                this.setObjectNotExists("action." + objName, {
                                                    type: "state",
                                                    common: {
                                                        name: "BK " + element.adr + " 1=up, 2=down, 3=stop",
                                                        type: "string",
                                                        role: "text",
                                                        read: true,
                                                        write: true,
                                                    },
                                                    native: {},
                                                });
                                                this.setState("state." + objName, { val: element.state, ack: true });
                                            } else if (element.type === "RT") {
                                                const objName = element.type + element.adr;
                                                if (element.adr.length != 6) {
                                                    this.log.error("this RT element has not 6 chars: " + element.adr);
                                                }
                                                this.setObjectNotExists("state." + objName, {
                                                    type: "state",
                                                    common: {
                                                        name: "RT " + element.adr,
                                                        type: "string",
                                                        role: "text",
                                                        read: true,
                                                        write: false,
                                                    },
                                                    native: {},
                                                });
                                                this.setObjectNotExists("action." + objName, {
                                                    type: "state",
                                                    common: {
                                                        name: "RT " + element.adr + " 1=up, 2=down, 3=stop",
                                                        type: "string",
                                                        role: "text",
                                                        read: true,
                                                        write: true,
                                                    },
                                                    native: {},
                                                });
                                            } else if (element.type === "ER") {
                                                const objName = element.type + element.adr;
                                                if (element.adr.length != 2) {
                                                    this.log.error("this ER element has not 2 chars: " + element.adr);
                                                }
                                                this.setObjectNotExists("state." + objName, {
                                                    type: "state",
                                                    common: {
                                                        name: "ER " + element.adr,
                                                        type: "string",
                                                        role: "text",
                                                        read: true,
                                                        write: false,
                                                    },
                                                    native: {},
                                                });
                                                this.setObjectNotExists("action." + objName, {
                                                    type: "state",
                                                    common: {
                                                        name: "ER " + element.adr + " 1=up, 2=down, 3=stop",
                                                        type: "string",
                                                        role: "text",
                                                        read: true,
                                                        write: true,
                                                    },
                                                    native: {},
                                                });
                                                this.setState("state." + objName, { val: element.state, ack: true });
                                            } else if (element.type === "HM") {
                                                if (JSON.stringify(element.state) != "{}") {
                                                    const objName = "homematic." + element.adr;
                                                    const hmState: HmState = JSON.parse(JSON.stringify(element.state));
                                                    if ("state" in hmState) {
                                                        this.log.debug(JSON.stringify(hmState.state));
                                                        this.setObjectNotExists(objName, {
                                                            type: "state",
                                                            common: {
                                                                name: "HM device with state",
                                                                type: "string",
                                                                role: "text",
                                                                read: true,
                                                                write: true,
                                                            },
                                                            native: {},
                                                        });
                                                        this.setState(objName, { val: hmState.state, ack: true });
                                                    }
                                                }
                                            } else {
                                                const objName = "sysvars.id" + element.adr;
                                                const description = "sysvar" + element.adr;
                                                objState = element.state;
                                                this.setObjectNotExists(objName, {
                                                    type: "state",
                                                    common: {
                                                        name: description,
                                                        type: "string",
                                                        role: "text",
                                                        read: true,
                                                        write: false,
                                                    },
                                                    native: {},
                                                });
                                                this.setState(objName, { val: objState, ack: true });
                                            }
                                        } else {
                                            this.log.error(
                                                "invalid sys var name from mediola device element.adr = " + element.adr,
                                            );
                                        }
                                    }
                                }
                            } else {
                                this.log.error("json format not known:" + JSON.stringify(jsonData));
                            }
                        } catch (error) {
                            this.log.error("json format invalid:" + JSON.stringify(jsonData));
                        }
                    } else {
                        this.log.error("mediola device rejected the request: " + res.data.toString());
                    }
                })
                .catch((error) => {
                    sysvarInit = false; // retry next time
                    this.log.error("mediola device not reached by getting sys vars");
                    this.log.error(error);
                });
        } else {
            this.log.debug("recalled with no effect");
        }
    }
    private async refreshStates(source: string): Promise<void> {
        this.log.debug("Source: " + source);
        // stop timer
        if (pullDataTimer != null) {
            this.log.debug("timer cleared by: " + source);
            this.clearTimeout(pullDataTimer);
        }
        if (this.config.pullData === true) {
            // suppress on init call
            if (source !== "onReady") {
                this.readAllSystemVars(true);
            }
            // start timer
            if (validMediolaFound) {
                let pullInterval = this.config.pullDataInterval;
                if (pullInterval < 1) {
                    pullInterval = 1;
                }
                pullDataTimer = this.setTimeout(() => {
                    pullDataTimer = null;
                    this.refreshStates("timeout (default)");
                }, pullInterval * 60000);
            }
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
    // /cmd?XC_FNC=SendSC&type=WR&data=01xaaaaaax0101 up
    // /cmd?XC_FNC=SendSC&type=WR&data=01xaaaaaax0102 down
    // /cmd?XC_FNC=SendSC&type=WR&data=01xaaaaaax0103 stop
    // /cmd?XC_FNC=SendSC&type=WR&data=01xaaaaaax0107pp pp=percent
    /**
     * Is called when databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        // Reset the connection indicator during startup
        this.setState("info.connection", false, true);
        this.extendObject("action", {
            type: "folder",
            common: {
                name: "action",
            },
        });
        this.extendObject("sysvars", {
            type: "folder",
            common: {
                name: "sysvars",
            },
        });
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
                    waitingForIpDevice = false;
                    validMediolaFound = true;
                    foundIpAddress = this.config.ip;
                    this.readAllSystemVars(false);
                    this.refreshStates("onReady");
                    this.setState("info.connection", true, true);
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
                        } else if (jsonData.type === "RT") {
                            // not yet seen, but should be intresting when received
                            this.log.debug(JSON.stringify(jsonData));
                        } else if (jsonData.type === "BK") {
                            // not yet seen, but should be intresting when received
                            this.log.debug(JSON.stringify(jsonData));
                        } else if (jsonData.type === "NY") {
                            // not yet seen, but should be intresting when received
                            this.log.debug(JSON.stringify(jsonData));
                        } else if (jsonData.type === "DY") {
                            // not yet seen, but should be intresting when received
                            this.log.debug(JSON.stringify(jsonData));
                        } else if (jsonData.type === "ER") {
                            // not yet seen, but should be intresting when received
                            this.log.debug(JSON.stringify(jsonData));
                        } else if (jsonData.type === "HM") {
                            // ignor HM data
                            this.log.debug(JSON.stringify(jsonData));
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
                let errorName = "No line with NAME: found.";
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
                    if (dataLine.startsWith("NAME:AIO GW")) {
                        mediolaFound = true;
                    }
                    if (dataLine.startsWith("NAME:WIR-CONNECT V6")) {
                        mediolaFound = true;
                    }
                    if (dataLine.startsWith("NAME:")) {
                        errorName = "unknown name line: " + dataLine;
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
                        this.readAllSystemVars(false);
                        this.refreshStates("onReady");
                    }
                } else {
                    this.log.error("unkown device on this port");
                    this.log.error(errorName);
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
        this.subscribeStates("sysvars.id*");
        this.subscribeStates("action.WR*");
        this.subscribeStates("action.BK*");
        this.subscribeStates("action.NY*");
        this.subscribeStates("action.DY*");
        this.subscribeStates("action.RT*");
        this.subscribeStates("action.ER*");
        this.subscribeStates("homematic.*");
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
                let subfolder = "";
                if (dataNameParts.length === 4) {
                    subfolder = dataNameParts[2];
                    dataName = dataNameParts[3];
                } else if (dataNameParts.length === 3) {
                    dataName = dataNameParts[2];
                } else if (dataNameParts.length > 4) {
                    if (dataNameParts[2] === "homematic") {
                        subfolder = dataNameParts[2];
                        dataName = dataNameParts[3];
                        for (let index = 4; index < dataNameParts.length; index++) {
                            dataName = dataName + "." + dataNameParts[index];
                        }
                    }
                } else {
                    this.log.debug("len: " + dataNameParts.length);
                    for (let index = 0; index < dataNameParts.length; index++) {
                        this.log.debug(index.toString() + " = " + dataNameParts[index]);
                    }
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
                                if (this.testResponse(res) === false) {
                                    this.log.error("sendIrData failed");
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
                                if (this.testResponse(res) === false) {
                                    this.log.error("sendRfData failed.");
                                }
                            })
                            .catch((error) => {
                                this.log.error("mediola device not reached by sending rf data");
                                this.log.error(error);
                            });
                    }
                } else if (dataName.startsWith("id")) {
                    if (subfolder === "sysvars") {
                        this.log.debug("got known event in sysvars: " + id + " " + JSON.stringify(state));
                    }
                    this.log.debug("got known event in root: " + id + " " + JSON.stringify(state));
                } else if (dataName.startsWith("WR")) {
                    if (subfolder === "action") {
                        const wrId = dataName.replace("WR", "");
                        let direction = "03"; // stop
                        let cmdType = "01";
                        let value = 0;
                        if (state.val !== null) {
                            const valueString = state.val.toString(16);
                            if (valueString.length < 3) {
                                value = parseInt(String(state.val));
                            }
                        }
                        if (state.val === "1") {
                            direction = "01";
                        } else if (state.val === "2") {
                            direction = "02";
                        } else if (state.val === "3") {
                            direction = "03";
                        } else if (value % 10 === 0 && value < 91 && value > 9) {
                            // assume percent
                            cmdType = "0107";
                            direction = value.toString(16);
                            direction = direction.padStart(2, "0");
                        } else {
                            this.log.error(
                                "only 1 (up), 2 (down) or 3 (stop) is allowed or value from 10 to 90 in 10 steps. For safety do a stop",
                            );
                        }
                        if (validMediolaFound) {
                            let reqUrl = this.genURL() + "XC_FNC=SendSC&type=WR&data=01" + wrId + cmdType + direction;
                            reqUrl = encodeURI(reqUrl);
                            axios
                                .get(reqUrl)
                                .then((res) => {
                                    this.log.debug(res.data);
                                    if (this.testResponse(res) === false) {
                                        this.log.error("WR data send failed");
                                    }
                                })
                                .catch((error) => {
                                    this.log.error("mediola device not reached by sending SC data to WR");
                                    this.log.error(error);
                                });
                        }
                    } else {
                        this.log.debug("Wrong subfolder: " + subfolder + "from device: " + dataName);
                    }
                } else if (dataName.startsWith("BK")) {
                    if (subfolder === "action") {
                        const actorId = dataName.replace("BK", "");
                        let direction = "02"; // stop as default
                        if (state.val === "1") {
                            direction = "00";
                        } else if (state.val === "2") {
                            direction = "01";
                        } else if (state.val == "3") {
                            direction = "02";
                        } else {
                            this.log.error("only 1 (up), 2 (down) or 3 (stop) is allowed. For safety do a stop");
                        }
                        if (validMediolaFound) {
                            let reqUrl = this.genURL() + "XC_FNC=SendSC&type=BK&data=0101" + actorId + direction;
                            reqUrl = encodeURI(reqUrl);
                            axios
                                .get(reqUrl)
                                .then((res) => {
                                    this.log.debug(res.data);
                                    if (this.testResponse(res) === false) {
                                        this.log.error("BK data send failed");
                                    }
                                })
                                .catch((error) => {
                                    this.log.error("mediola device not reached by sending SC data to BK");
                                    this.log.error(error);
                                });
                        }
                    } else {
                        this.log.debug("Wrong subfolder: " + subfolder + "from device: " + dataName);
                    }
                } else if (dataName.startsWith("RT")) {
                    if (subfolder === "action") {
                        const actorId = dataName.replace("RT", "");
                        let direction = "10"; // stop as default
                        if (state.val === "1") {
                            direction = "20";
                        } else if (state.val === "2") {
                            direction = "40";
                        } else if (state.val == "3") {
                            direction = "10";
                        } else {
                            this.log.error("only 1 (up), 2 (down) or 3 (stop) is allowed. For safety do a stop");
                        }
                        if (validMediolaFound) {
                            let reqUrl = this.genURL() + "XC_FNC=SendSC&type=RT&data=" + direction + actorId;
                            reqUrl = encodeURI(reqUrl);
                            axios
                                .get(reqUrl)
                                .then((res) => {
                                    this.log.debug(res.data);
                                    if (this.testResponse(res) === false) {
                                        this.log.error("RT data send failed");
                                    }
                                })
                                .catch((error) => {
                                    this.log.error("mediola device not reached by sending SC data to RT");
                                    this.log.error(error);
                                });
                        }
                    } else {
                        this.log.debug("Wrong subfolder: " + subfolder + "from device: " + dataName);
                    }
                } else if (dataName.startsWith("NY")) {
                    if (subfolder === "action") {
                        const actorId = dataName.replace("NY", "");
                        if (actorId.length === 8) {
                            let direction = "00"; // stop as default
                            if (state.val === "1") {
                                direction = "22";
                            } else if (state.val === "2") {
                                direction = "44";
                            } else if (state.val === "3") {
                                direction = "00";
                            } else if (state.val === "4") {
                                direction = "55";
                            } else {
                                this.log.error(
                                    "only 1 (up), 2 (down), 3 (stop) or 4 (stop 55) is allowed. For safety do a stop",
                                );
                            }
                            if (validMediolaFound) {
                                let reqUrl = this.genURL() + "XC_FNC=SendSC&type=NY&data=" + actorId + direction;
                                reqUrl = encodeURI(reqUrl);
                                axios
                                    .get(reqUrl)
                                    .then((res) => {
                                        this.log.debug(res.data);
                                        if (this.testResponse(res) === false) {
                                            this.log.error("NY data send failed");
                                        }
                                    })
                                    .catch((error) => {
                                        this.log.error("mediola device not reached by sending SC data to NY");
                                        this.log.error(error);
                                    });
                            }
                        } else {
                            this.log.error("NY id is not 8 chars long.");
                        }
                    } else {
                        this.log.debug("Wrong subfolder: " + subfolder + "from device: " + dataName);
                    }
                } else if (dataName.startsWith("DY")) {
                    if (subfolder === "action") {
                        const actorId = dataName.replace("DY", "");
                        if (actorId.length === 8) {
                            let direction = "55"; // stop as default
                            if (state.val === "1") {
                                direction = "11";
                            } else if (state.val === "2") {
                                direction = "33";
                            } else if (state.val === "3") {
                                direction = "55";
                            } else {
                                this.log.error("only 1 (up), 2 (down) or 3 (stop) is allowed. For safety do a stop");
                            }
                            if (validMediolaFound) {
                                let reqUrl = this.genURL() + "XC_FNC=SendSC&type=DY&data=" + actorId + direction;
                                reqUrl = encodeURI(reqUrl);
                                axios
                                    .get(reqUrl)
                                    .then((res) => {
                                        this.log.debug(res.data);
                                        if (this.testResponse(res) === false) {
                                            this.log.error("DY data send failed");
                                        }
                                    })
                                    .catch((error) => {
                                        this.log.error("mediola device not reached by sending SC data to DY");
                                        this.log.error(error);
                                    });
                            }
                        } else {
                            this.log.error("DY id is not 8 chars long.");
                        }
                    } else {
                        this.log.debug("Wrong subfolder: " + subfolder + "from device: " + dataName);
                    }
                } else if (dataName.startsWith("ER")) {
                    if (subfolder === "action") {
                        const actorId = dataName.replace("ER", "");
                        if (actorId.length === 2) {
                            let direction = "02"; // stop as default
                            if (state.val === "1") {
                                direction = "01";
                            } else if (state.val === "2") {
                                direction = "00";
                            } else if (state.val === "3") {
                                direction = "02";
                            } else {
                                this.log.error("only 1 (up), 2 (down) or 3 (stop) is allowed. For safety do a stop");
                            }
                            if (validMediolaFound) {
                                let reqUrl = this.genURL() + "XC_FNC=SendSC&type=ER&data=" + actorId + direction;
                                reqUrl = encodeURI(reqUrl);
                                axios
                                    .get(reqUrl)
                                    .then((res) => {
                                        this.log.debug(res.data);
                                        this.log.debug(reqUrl);
                                        if (this.testResponse(res) === false) {
                                            this.log.error("ER data send failed");
                                        }
                                    })
                                    .catch((error) => {
                                        this.log.error("mediola device not reached by sending SC data to ER");
                                        this.log.error(error);
                                    });
                            }
                        } else {
                            this.log.error("ER id is not 2 chars long.");
                        }
                    } else {
                        this.log.debug("Wrong subfolder: " + subfolder + "from device: " + dataName);
                    }
                } else if (subfolder === "homematic") {
                    this.log.debug("got hm event: " + JSON.stringify(state));
                    if (validMediolaFound) {
                        let reqUrl = this.genURL() + "XC_FNC=SendSC&type=HM&address=" + dataName + "&data=" + state.val;
                        reqUrl = encodeURI(reqUrl);
                        axios
                            .get(reqUrl)
                            .then((res) => {
                                this.log.debug(res.data);
                                this.log.debug(JSON.stringify(res.data));
                                this.log.debug(reqUrl);
                                if (this.testResponse(res) === false) {
                                    this.log.error("homematic data send failed");
                                }
                            })
                            .catch((error) => {
                                this.log.error("mediola device not reached by sending HM data");
                                this.log.error(error);
                            });
                    }
                } else {
                    this.log.debug("got unknown event: " + JSON.stringify(state));
                    this.log.debug("got unknown name: " + dataName);
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
