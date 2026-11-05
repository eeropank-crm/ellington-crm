// Test preload: emulate Zone's SESSION default without ever changing GLOBAL mode.
const mysql=require('mysql2');
const create=mysql.createConnection;
mysql.createConnection=function(config){
 if(config.host!=='127.0.0.1'||Number(config.port)!==3308||config.database!=='ellington_test_deploy')throw Error('Non-strict fixture only supports the isolated test database.');
 const connection=create.call(this,config),connect=connection.connect.bind(connection);
 connection.connect=function(callback){return connect(error=>{
  if(error)return callback(error);
  connection.query('SET SESSION sql_mode = ?',['IGNORE_SPACE,NO_AUTO_CREATE_USER'],error=>callback(error));
 });};
 return connection;
};
