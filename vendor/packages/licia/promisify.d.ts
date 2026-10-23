import types = require('./types');

declare function promisify<TArgs extends any[], TResult>(
    fn: (...args: [...TArgs, (err: any, result: TResult) => void]) => any,
    multiArgs?: false
): (...args: TArgs) => Promise<TResult>;
declare function promisify(
    fn: types.AnyFn,
    multiArgs?: boolean
): (...args: any[]) => Promise<any>;

export = promisify;
