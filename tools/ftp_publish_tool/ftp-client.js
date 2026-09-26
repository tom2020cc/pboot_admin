const ftp = require('basic-ftp');
const os = require('os');
const net = require('net');

function networkInterfaces() {
  return Object.entries(os.networkInterfaces()).flatMap(([name, addresses]) =>
    addresses.filter(item => item.family === 'IPv4' && !item.internal).map(item => ({ name, address: item.address })));
}
function resolveLocalAddress(config) {
  if (!config.networkInterface) return undefined;
  const selected = networkInterfaces().find(item => item.name === config.networkInterface);
  if (!selected) throw new Error('所选连接网卡不可用，请重新选择网卡并保存连接');
  return selected.address;
}
function createFtpClient(config, timeout = 20000) {
  const client = new ftp.Client(timeout);
  const localAddress = resolveLocalAddress(config);
  if (localAddress) {
    // basic-ftp 5.x uses this factory for BOTH control and passive data sockets.
    // Keep the adaptation per-client; never change global net.Socket or OS routing.
    client.ftp._newSocket = () => {
      const socket = new net.Socket();
      const connect = socket.connect;
      socket.connect = function (options, ...args) { return connect.call(this, { ...options, localAddress }, ...args); };
      return socket;
    };
  }
  return client;
}
module.exports = { createFtpClient, networkInterfaces, resolveLocalAddress };
