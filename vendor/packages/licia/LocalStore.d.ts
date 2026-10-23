import Store = require('./Store');

declare class LocalStore extends Store {
    constructor(name: string, data?: Record<string, any>);
}

export = LocalStore;
