import types = require('./types');

declare function pluck<T, K extends keyof T>(
    list: types.List<T>,
    key: K
): T[K][];
declare function pluck(object: any, key: string | string[]): any[];

export = pluck;
