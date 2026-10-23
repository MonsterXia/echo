import Emitter = require('./Emitter');
import each = require('./each');

declare class Store extends Emitter {
    constructor(data?: Record<string, any>);
    set<T>(key: string, val: T): void;
    set(values: Record<string, any>): void;
    get<T = any>(key: string): T;
    get(keys: string[]): Record<string, any>;
    remove(key: string): void;
    remove(keys: string[]): void;
    clear(): void;
    each(fn: (val: any, key: string) => void): void;
}

export = Store;
