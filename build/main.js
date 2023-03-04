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
function isMediolaEvt(o) {
  return "type" in o && "data" in o;
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
    this.subscribeStates("sendIrData");
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
            this.log.debug(error);
          });
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
