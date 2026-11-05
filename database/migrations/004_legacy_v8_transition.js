'use strict';
exports.config={transaction:false};
exports.up=async db=>require('../../ops/legacy-transition').perform(db);
exports.down=async()=>{throw Error('Forward-only DDL: restore the verified backup into a separate database.');};
