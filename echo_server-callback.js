"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

var net = require("net");

function newConnection(socket) {
  console.log(
    "New connection from ",
    socket.remoteAddress + ":" + socket.remotePort
  );
}

var server = net.createServer();

// throw err if something goes wrong
server.on("error", function (err) {
  throw err;
});

// run the callback on new connection
server.on("connection", newConnection);

// bind and listen on the address and port
server.listen({ host: "127.0.0.1", port: 1234 });
