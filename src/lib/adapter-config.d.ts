// This file extends the AdapterConfig type from "@types/iobroker"

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
    namespace ioBroker {
        interface AdapterConfig {
            autoDetect: boolean;
            findByMac: boolean;
            mac: string;
            findByIp: boolean;
            ip: string;
            password: string;
        }
    }
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};
