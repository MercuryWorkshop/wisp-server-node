import { LOG_LEVEL } from "../Types.js";

export class Logger {
    logLevel: number;
    constructor(logLevel: LOG_LEVEL) {
        this.logLevel = logLevel;
    }
    getTimestamp() {
        let [date, time] = new Date().toJSON().split("T");
        date = date.replaceAll("-", "/");
        time = time.split(".")[0];
        return `[${date} - ${time}]`;
    }

    debug(...messages: any) {
        if (this.logLevel > LOG_LEVEL.DEBUG) return;
        console.debug(this.getTimestamp() + " debug:", ...messages);
    }

    info(...messages: any) {
        if (this.logLevel > LOG_LEVEL.INFO) return;
        console.info(this.getTimestamp() + " info:", ...messages);
    }

    log(...messages: any) {
        if (this.logLevel > LOG_LEVEL.INFO) return;
        console.log(this.getTimestamp() + " log:", ...messages);
    }

    warn(...messages: any) {
        if (this.logLevel > LOG_LEVEL.WARN) return;
        console.warn(this.getTimestamp() + " warn:", ...messages);
    }

    error(...messages: any) {
        if (this.logLevel > LOG_LEVEL.ERROR) return;
        console.error(this.getTimestamp() + " error:", ...messages);
    }
}

