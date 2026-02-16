declare module 'node-windows' {
  interface ServiceConfig {
    name: string;
    description: string;
    script: string;
    env?: Array<{ name: string; value: string }>;
  }

  export class Service {
    constructor(config: ServiceConfig);
    on(event: 'install' | 'uninstall' | 'start' | 'stop' | 'alreadyinstalled' | 'error', callback: (err?: Error) => void): void;
    install(): void;
    uninstall(): void;
    start(): void;
    stop(): void;
  }
}

declare module 'node-mac' {
  interface ServiceConfig {
    name: string;
    description: string;
    script: string;
    env?: Array<{ name: string; value: string }>;
  }

  export class Service {
    constructor(config: ServiceConfig);
    on(event: 'install' | 'uninstall' | 'start' | 'stop' | 'alreadyinstalled' | 'error', callback: (err?: Error) => void): void;
    install(): void;
    uninstall(): void;
    start(): void;
    stop(): void;
  }
}

declare module 'node-linux' {
  interface ServiceConfig {
    name: string;
    description: string;
    script: string;
    env?: Array<{ name: string; value: string }>;
  }

  export class Service {
    constructor(config: ServiceConfig);
    on(event: 'install' | 'uninstall' | 'start' | 'stop' | 'alreadyinstalled' | 'error', callback: (err?: Error) => void): void;
    install(): void;
    uninstall(): void;
    start(): void;
    stop(): void;
  }
}
