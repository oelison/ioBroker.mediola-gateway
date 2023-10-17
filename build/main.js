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
let pullDataTimer = null;
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
  genURL() {
    let retVal = "";
    if (this.config.username === "") {
      retVal = "http://" + foundIpAddress + "/command?";
    } else {
      retVal = "http://" + foundIpAddress + "/command?XC_USER=" + this.config.username + "&XC_PASS=" + this.config.password + "&";
    }
    return retVal;
  }
  async readAllSystemVars(timerRead) {
    this.log.debug(
      "validMediola: " + validMediolaFound + " sysvarInti: " + sysvarInit + " timerRead: " + timerRead
    );
    if (validMediolaFound && !sysvarInit || timerRead) {
      sysvarInit = true;
      let reqUrl = this.genURL() + "XC_FNC=getstates";
      reqUrl = encodeURI(reqUrl);
      import_axios.default.get(reqUrl).then((res) => {
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
                  if (this.validName(element.adr)) {
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
                          write: false
                        },
                        native: {}
                      });
                      this.setObjectNotExists("action." + objName, {
                        type: "state",
                        common: {
                          name: "WIR " + element.adr + " 1=up, 2=down, 3=stop",
                          type: "string",
                          role: "text",
                          read: true,
                          write: true
                        },
                        native: {}
                      });
                      if (element.state.length === 6) {
                        const hexVal = element.state.substring(2, 4);
                        const dezVal = parseInt(hexVal, 16);
                        this.setState("state." + objName, { val: dezVal, ack: true });
                      } else {
                        this.log.error(
                          "state length not 6 element.state: " + element.state
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
                          write: false
                        },
                        native: {}
                      });
                      this.setObjectNotExists("action." + objName, {
                        type: "state",
                        common: {
                          name: "BK " + element.adr + " 1=up, 2=down, 3=stop",
                          type: "string",
                          role: "text",
                          read: true,
                          write: true
                        },
                        native: {}
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
                          write: false
                        },
                        native: {}
                      });
                      this.setObjectNotExists("action." + objName, {
                        type: "state",
                        common: {
                          name: "RT " + element.adr + " 1=up, 2=down, 3=stop",
                          type: "string",
                          role: "text",
                          read: true,
                          write: true
                        },
                        native: {}
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
                          write: false
                        },
                        native: {}
                      });
                      this.setObjectNotExists("action." + objName, {
                        type: "state",
                        common: {
                          name: "ER " + element.adr + " 1=up, 2=down, 3=stop",
                          type: "string",
                          role: "text",
                          read: true,
                          write: true
                        },
                        native: {}
                      });
                      this.setState("state." + objName, { val: element.state, ack: true });
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
                          write: false
                        },
                        native: {}
                      });
                      this.setState(objName, { val: objState, ack: true });
                    }
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
    } else {
      this.log.debug("recalled with no effect");
    }
  }
  async refreshStates(source) {
    this.log.debug("Source: " + source);
    if (pullDataTimer != null) {
      this.log.debug("timer cleared by: " + source);
      this.clearTimeout(pullDataTimer);
    }
    if (this.config.pullData === true) {
      if (source !== "onReady") {
        this.readAllSystemVars(true);
      }
      if (validMediolaFound) {
        let pullInterval = this.config.pullDataInterval;
        if (pullInterval < 1) {
          pullInterval = 1;
        }
        pullDataTimer = this.setTimeout(() => {
          pullDataTimer = null;
          this.refreshStates("timeout (default)");
        }, this.config.pullDataInterval * 6e4);
      }
    }
  }
  async onReady() {
    this.setState("info.connection", false, true);
    this.extendObject("action", {
      type: "folder",
      common: {
        name: "action"
      }
    });
    this.extendObject("sysvars", {
      type: "folder",
      common: {
        name: "sysvars"
      }
    });
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
                this.log.debug("sys var type not known: " + jsonData.data);
              }
            } else if (jsonData.type === "WR") {
              this.log.debug(JSON.stringify(jsonData));
            } else if (jsonData.type === "RT") {
              this.log.debug(JSON.stringify(jsonData));
            } else if (jsonData.type === "BK") {
              this.log.debug(JSON.stringify(jsonData));
            } else if (jsonData.type === "NY") {
              this.log.debug(JSON.stringify(jsonData));
            } else if (jsonData.type === "DY") {
              this.log.debug(JSON.stringify(jsonData));
            } else if (jsonData.type === "ER") {
              this.log.debug(JSON.stringify(jsonData));
            } else if (jsonData.type === "HM") {
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
    this.subscribeStates("sysvars.id*");
    this.subscribeStates("action.WR*");
    this.subscribeStates("action.BK*");
    this.subscribeStates("action.NY*");
    this.subscribeStates("action.DY*");
    this.subscribeStates("action.RT*");
    this.subscribeStates("action.ER*");
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
      this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
      if (state.ack === false) {
        const dataNameParts = id.split(".");
        let dataName = "";
        let subfolder = "";
        if (dataNameParts.length === 4) {
          subfolder = dataNameParts[2];
          dataName = dataNameParts[3];
        } else if (dataNameParts.length === 3) {
          dataName = dataNameParts[2];
        }
        if (dataName === "sendIrData") {
          this.log.debug("try send: " + state.val);
          if (validMediolaFound) {
            let reqUrl = this.genURL() + "XC_FNC=Send2&code=" + state.val;
            reqUrl = encodeURI(reqUrl);
            import_axios.default.get(reqUrl).then((res) => {
              this.log.debug(res.data);
              if (res.data.toString().includes("XC_SUC") === false) {
                this.log.error("mediola device rejected the command: " + state.val);
              }
            }).catch((error) => {
              this.log.error("mediola device not reached by sending IR data");
              this.log.error(error);
            });
          }
        } else if (dataName === "sendRfData") {
          this.log.debug("try send: " + state.val);
          if (validMediolaFound) {
            let reqUrl = this.genURL() + "XC_FNC=Send2&ir=00&rf=01&code=" + state.val;
            reqUrl = encodeURI(reqUrl);
            import_axios.default.get(reqUrl).then((res) => {
              this.log.debug(res.data);
              if (res.data.toString().includes("XC_SUC") === false) {
                this.log.error("mediola device rejected the command: " + state.val);
              }
            }).catch((error) => {
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
            let direction = "03";
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
              cmdType = "0107";
              direction = value.toString(16);
              direction = direction.padStart(2, "0");
            } else {
              this.log.error(
                "only 1 (up), 2 (down) or 3 (stop) is allowed or value from 10 to 90 in 10 steps. For safety do a stop"
              );
            }
            if (validMediolaFound) {
              let reqUrl = this.genURL() + "XC_FNC=SendSC&type=WR&data=01" + wrId + cmdType + direction;
              reqUrl = encodeURI(reqUrl);
              import_axios.default.get(reqUrl).then((res) => {
                this.log.debug(res.data);
                if (res.data.toString().includes("XC_SUC") === false) {
                  this.log.error(
                    "mediola device rejected the command: " + state.val + " response: " + res.data
                  );
                }
              }).catch((error) => {
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
            let direction = "02";
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
              import_axios.default.get(reqUrl).then((res) => {
                this.log.debug(res.data);
                if (res.data.toString().includes("XC_SUC") === false) {
                  this.log.error(
                    "mediola device rejected the command: " + state.val + " response: " + res.data
                  );
                }
              }).catch((error) => {
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
            let direction = "10";
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
              import_axios.default.get(reqUrl).then((res) => {
                this.log.debug(res.data);
                if (res.data.toString().includes("XC_SUC") === false) {
                  this.log.error(
                    "mediola device rejected the command: " + state.val + " response: " + res.data
                  );
                }
              }).catch((error) => {
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
              let direction = "00";
              if (state.val === "1") {
                direction = "22";
              } else if (state.val === "2") {
                direction = "44";
              } else if (state.val === "3") {
                direction = "00";
              } else {
                this.log.error("only 1 (up), 2 (down) or 3 (stop) is allowed. For safety do a stop");
              }
              if (validMediolaFound) {
                let reqUrl = this.genURL() + "XC_FNC=SendSC&type=NY&data=" + actorId + direction;
                reqUrl = encodeURI(reqUrl);
                import_axios.default.get(reqUrl).then((res) => {
                  this.log.debug(res.data);
                  if (res.data.toString().includes("XC_SUC") === false) {
                    this.log.error(
                      "mediola device rejected the command: " + state.val + " response: " + res.data
                    );
                  }
                }).catch((error) => {
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
              let direction = "55";
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
                import_axios.default.get(reqUrl).then((res) => {
                  this.log.debug(res.data);
                  if (res.data.toString().includes("XC_SUC") === false) {
                    this.log.error(
                      "mediola device rejected the command: " + state.val + " response: " + res.data
                    );
                  }
                }).catch((error) => {
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
              let direction = "02";
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
                import_axios.default.get(reqUrl).then((res) => {
                  this.log.debug(res.data);
                  this.log.debug(reqUrl);
                  if (res.data.toString().includes("XC_SUC") === false) {
                    this.log.error(
                      "mediola device rejected the command: " + state.val + " response: " + res.data
                    );
                  }
                }).catch((error) => {
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
        } else {
          this.log.debug("got unknown event: " + JSON.stringify(state));
        }
      }
    } else {
      this.log.debug(`state ${id} deleted`);
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new MediolaGateway(options);
} else {
  (() => new MediolaGateway())();
}
//# sourceMappingURL=main.js.map
