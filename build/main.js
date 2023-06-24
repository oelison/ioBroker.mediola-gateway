"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var utils = __toESM(require("@iobroker/adapter-core"));
var import_axios = __toESM(require("axios"));
var dgram = __toESM(require("dgram"));
const inSocket = dgram.createSocket("udp4");
const outSocket = dgram.createSocket("udp4");
let waitingForAnyDevice = false;
let waitingForMacDevice = false;
let waitingForIpDevice = false;
let foundMacAddress = "";
let foundIpAddress = "";
let validMediolaFound = false;
let sysvarInit = false;
function isMediolaEvt(o) {
  return "type" in o && "data" in o;
}
function isMediolaSysVarArray(o) {
  return true;
}
class MediolaGateway extends utils.Adapter {
  constructor(options = {}) {
    super({
      ...options,
      name: "mediola-gateway"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  validName(Name) {
    const CheckName = Name.replace(this.FORBIDDEN_CHARS, "_");
    if (CheckName == Name) {
      return true;
    } else {
      return false;
    }
  }
  async readAllSystemVars() {
    if (validMediolaFound && !sysvarInit) {
      sysvarInit = true;
      let reqUrl = "http://" + foundIpAddress + "/command?XC_FNC=getstates";
      reqUrl = encodeURI(reqUrl);
      this.log.debug("url request to mediola: " + reqUrl);
      import_axios.default.get(reqUrl).then((res) => {
        this.log.debug(res.data);
        if (res.data.startsWith("{XC_SUC}")) {
          this.log.debug("mediola device found data: " + res.data);
          try {
            const jsonData = JSON.parse(res.data.substring(8));
            if (isMediolaSysVarArray(jsonData)) {
              if (jsonData.length > 0) {
                for (let index = 0; index < jsonData.length; index++) {
                  const element = jsonData[index];
                  this.log.debug(JSON.stringify(element));
                  if (this.validName(element.adr)) {
                    this.setObjectNotExists("id" + element.adr, {
                      type: "state",
                      common: {
                        name: "sysvar" + element.adr,
                        type: "string",
                        role: "text",
                        read: true,
                        write: false
                      },
                      native: {}
                    });
                    this.setState("id" + element.adr, { val: element.state, ack: true });
                  } else {
                    this.log.error(
                      "invalid sys var name from mediola device element.adr = " + element.adr
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
      }).catch((error) => {
        sysvarInit = false;
        this.log.error("mediola device not reached by getting sys vars");
        this.log.error(error);
      });
    }
  }
  async onReady() {
    this.setState("info.connection", false, true);
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
                this.setState("id" + index, { val: value, ack: true });
              } else {
                this.log.debug("data type not known");
              }
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
          this.log.info(dataLine);
          if (dataLine.startsWith("IP:")) {
            ipAddress = dataLine.substring(3);
          }
          if (dataLine.startsWith("MAC:")) {
            macAddress = dataLine.substring(4);
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
    await this.setObjectNotExistsAsync("receivedIrData", {
      type: "state",
      common: {
        name: "receivedIrData",
        type: "string",
        role: "text",
        read: true,
        write: false
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("sendIrData", {
      type: "state",
      common: {
        name: "sendIrData",
        type: "string",
        role: "text",
        read: true,
        write: true
      },
      native: {}
    });
    await this.setObjectNotExistsAsync("sendRfData", {
      type: "state",
      common: {
        name: "sendRfData",
        type: "string",
        role: "text",
        read: true,
        write: true
      },
      native: {}
    });
    this.subscribeStates("sendIrData");
    this.subscribeStates("sendRfData");
  }
  onUnload(callback) {
    try {
      inSocket.close();
      outSocket.close();
      callback();
    } catch (e) {
      callback();
    }
  }
  onStateChange(id, state) {
    if (state) {
      this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
      if (state.ack === false) {
        if (id.endsWith("sendIrData")) {
          this.log.debug("try send: " + state.val);
          if (validMediolaFound) {
            let reqUrl = "http://" + foundIpAddress + "/command?XC_FNC=Send2&code=" + state.val;
            reqUrl = encodeURI(reqUrl);
            this.log.debug("url request to mediola: " + reqUrl);
            import_axios.default.get(reqUrl).then((res) => {
              this.log.debug(res.data);
              if (res.data != "{XC_SUC}") {
                this.log.error("mediola device rejected the command: " + state.val);
              }
            }).catch((error) => {
              this.log.error("mediola device not reached by sending IR data");
              this.log.error(error);
            });
          }
        } else if (id.endsWith("sendRfData")) {
          this.log.debug("try send: " + state.val);
          if (validMediolaFound) {
            let reqUrl = "http://" + foundIpAddress + "/command?XC_FNC=Send2&ir=00&rf=01&code=" + state.val;
            reqUrl = encodeURI(reqUrl);
            this.log.debug("url request to mediola: " + reqUrl);
            import_axios.default.get(reqUrl).then((res) => {
              this.log.debug(res.data);
              if (res.data != "{XC_SUC}") {
                this.log.error("mediola device rejected the command: " + state.val);
              }
            }).catch((error) => {
              this.log.error("mediola device not reached by sending rf data");
              this.log.error(error);
            });
          }
        }
      }
    } else {
      this.log.info(`state ${id} deleted`);
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new MediolaGateway(options);
} else {
  (() => new MediolaGateway())();
}
//# sourceMappingURL=main.js.map
