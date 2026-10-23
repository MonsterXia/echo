import types = require('./types');

declare function remove<T>(
    list: types.List<T>,
    iterator: types.ListIterator<T, boolean>,
    context?: any
): T[];

export = remove;
