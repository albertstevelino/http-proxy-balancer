require('dotenv').config();

var http = require('http'),
  httpProxy = require('http-proxy'),
  url = require('url'),
  net = require('net'),
  _ = require('lodash'),
  crypto = require('crypto'),
  argv = require('yargs').argv,
  { servers } = require('./config');

var proxy = httpProxy.createServer();
var port = process.env.PORT || argv.port || 7001;
var username = process.env.USERNAME;
var password = process.env.PASSWORD;
var token = 'Basic ' + Buffer.from(username + ':' + password).toString('base64');

var balancer = http.createServer().listen(port);

var getModFromId = (id, max) => {
  var hash = crypto.createHash('md5').update(id.toString()).digest("hex");
  var product = hash.charCodeAt(0) * hash.charCodeAt(1);

  return product % max;
};

balancer.on('connect', function (req, socket) {
  try {
    var authToken = req.headers['proxy-authorization'];
    var stickyId = _.get(req.headers, 'x-sticky-id');
    var remoteIpAddress = req.connection.remoteAddress;
    console.log(`Receiving reverse proxy request for: ${req.url} from IP ${remoteIpAddress}`);

    if (_.isEmpty(servers)) {
      console.log('No server available.');
      socket.write('HTTP/1.1 503 No Proxy Available\r\n' +
        'Proxy-agent: Node-Proxy\r\n' +
        '\r\n');

      socket.end();
      return;
    }

    if (authToken !== token) {
      console.log(`${remoteIpAddress} Failed to authorzed the request`);
      socket.write('HTTP/1.1 403 Authorization Failed\r\n' +
        'Proxy-agent: Node-Proxy\r\n' +
        '\r\n');

      socket.end();
      return;
    }

    var serversCount = servers.length;
    var selectedServer = stickyId ? servers[getModFromId(stickyId, serversCount)] : _.sample(servers);

    console.log(`Solving ${req.url} from IP ${remoteIpAddress} with proxy ${JSON.stringify(selectedServer)}`);

    var srvSocket = net.connect(selectedServer.port, selectedServer.host, function() {
      var connectMsg = 'CONNECT ' + req.url + ' HTTP/1.1\r\n';

      Object.keys(req.headers).forEach(function(name) {
        connectMsg += name + ': ' + req.headers[name] + '\r\n';
      });

      srvSocket.write(connectMsg + '\r\n');
      socket.write('HTTP/1.1 200 Connection Established\r\n' +
        'Proxy-agent: Node-Proxy\r\n' +
        '\r\n');
      srvSocket.pipe(socket);
      socket.pipe(srvSocket);
    });
  } catch (error) {
    console.error(error);

    socket.write('HTTP/1.1 500 Proxy Server Error\r\n' +
      'Proxy-agent: Node-Proxy\r\n' +
      '\r\n');

    socket.end();
  }
});

console.log(`http proxy balancer starts on port ${port}`);

