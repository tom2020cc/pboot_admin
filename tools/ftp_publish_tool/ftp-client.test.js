const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const net = require('net');
const { networkInterfaces, resolveLocalAddress, createFtpClient } = require('./ftp-client');

test('interface selection resolves current IPv4 and rejects missing interfaces', () => {
  const original = os.networkInterfaces;
  os.networkInterfaces = () => ({ Ethernet: [{ family: 'IPv4', address: '192.168.1.5', internal: false }], Loopback: [{ family: 'IPv4', address: '127.0.0.1', internal: true }] });
  try {
    assert.deepEqual(networkInterfaces(), [{ name: 'Ethernet', address: '192.168.1.5' }]);
    assert.equal(resolveLocalAddress({ networkInterface: 'Ethernet' }), '192.168.1.5');
    assert.equal(resolveLocalAddress({}), undefined);
    assert.throws(() => resolveLocalAddress({ networkInterface: 'Removed' }), /网卡不可用/);
  } finally { os.networkInterfaces = original; }
});
test('control and passive sockets bind per client without altering global sockets', async () => {
  const original = os.networkInterfaces, originalConnect = net.Socket.prototype.connect;
  os.networkInterfaces = () => ({ Test: [{ family: 'IPv4', address: '127.0.0.1', internal: false }] });
  const server = net.createServer(socket => { socket.write('220 Test FTP\r\n'); socket.on('data', () => socket.end()); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = createFtpClient({ networkInterface: 'Test' });
  try {
    await client.connect('127.0.0.1', server.address().port);
    assert.equal(client.ftp.socket.localAddress, '127.0.0.1');
    const dataSocket = client.ftp._newSocket();
    await new Promise((resolve, reject) => { dataSocket.on('error', reject); dataSocket.connect({ host: '127.0.0.1', port: server.address().port }, resolve); });
    assert.equal(dataSocket.localAddress, '127.0.0.1'); dataSocket.destroy();
    assert.equal(net.Socket.prototype.connect, originalConnect);
  } finally { client.close(); os.networkInterfaces = original; server.close(); }
});
