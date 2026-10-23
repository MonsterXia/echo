declare function sortBy<T>(
    arr: T[],
    iterator?: keyof T | ((item: T, index: number, list: T[]) => any),
    ctx?: any
): T[];

export = sortBy;
