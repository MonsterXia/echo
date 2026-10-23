declare function waitUntil<T>(
    condition: () => T | PromiseLike<T>,
    timeout?: number,
    interval?: number
): Promise<T>;

export = waitUntil;
