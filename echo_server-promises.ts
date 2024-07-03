import * as net from "net";

// promise-based API for TCP sockets
type TCPConn = {
  // the JS socket object
  socket: net.Socket;

  // from the 'error' event
  err: null | Error;

  // EOF, from the 'end' event
  ended: boolean;

  // the callbacks of the promise of the current read
  reader: null | {
    resolve: (value: Buffer) => void;
    reject: (reason: Error) => void;
  };
};

// a dynamic-sized buffer
type DynBuf = {
  data: Buffer;
  length: number;
};

// wrapper from net.Socket
function socketInit(socket: net.Socket): TCPConn {
  const conn: TCPConn = {
    socket: socket,
    reader: null,
    err: null,
    ended: false,
  };

  socket.on("data", (data: Buffer) => {
    console.assert(conn.reader);

    // pause the 'data' event until next read
    conn.socket.pause();

    // fulfill promise of current read
    conn.reader!.resolve(data);
    conn.reader = null;
  });

  socket.on("end", () => {
    // this also fulfills current read
    conn.ended = true;

    if (conn.reader) {
      // EOF
      conn.reader.resolve(Buffer.from(""));
      conn.reader = null;
    }
  });

  socket.on("error", (err: Error) => {
    // errors are also delivered to current read
    conn.err = err;

    if (conn.reader) {
      conn.reader.reject(err);
      conn.reader = null;
    }
  });

  return conn;
}

function socketRead(conn: TCPConn): Promise<Buffer> {
  // no concurrent calls from same connection
  console.assert(!conn.reader);

  return new Promise((resolve, reject) => {
    // if connection is not readable, complete promise now
    if (conn.err) {
      reject(conn.err);
      return;
    }

    if (conn.ended) {
      // EOF
      resolve(Buffer.from(""));
      return;
    }

    // save promise callbacks
    conn.reader = { resolve: resolve, reject: reject };

    // resume 'data' event to fulfill promise later
    conn.socket.resume();
  });
}

function socketWrite(conn: TCPConn, data: Buffer): Promise<void> {
  console.assert(data.length > 0);

  return new Promise((resolve, reject) => {
    if (conn.err) {
      reject(conn.err);
      return;
    }

    conn.socket.write(data, (err?: Error) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

// append data to DynBuf
function bufPush(buf: DynBuf, data: Buffer): void {
  const newLen = buf.length + data.length;

  if (buf.data.length < newLen) {
    // grow the capacity by the power of two
    let cap = Math.max(buf.data.length, 32);

    while (cap < newLen) {
      cap *= 2;
    }

    const grown = Buffer.alloc(cap);
    buf.data.copy(grown, 0, 0);
    buf.data = grown;
  }

  data.copy(buf.data, buf.length, 0);
  buf.length = newLen;
}

// remove data from the front
function bufPop(buf: DynBuf, len: number): void {
  buf.data.copyWithin(0, len, buf.length);
  buf.length -= len;
}

function cutMessage(buf: DynBuf): null | Buffer {
  // messages are separated by '\n'
  const idx = buf.data.subarray(0, buf.length).indexOf("\n");

  if (idx < 0) {
    // not complete
    return null;
  }

  // make a copy of the message and move the remaining data to the front
  const msg = Buffer.from(buf.data.subarray(0, idx + 1));
  bufPop(buf, idx + 1);

  return msg;
}

async function serveClient(socket: net.Socket): Promise<void> {
  const conn: TCPConn = socketInit(socket);
  const buf: DynBuf = { data: Buffer.alloc(0), length: 0 };

  try {
    while (true) {
      // try to get 1 message from the buffer
      let msg: null | Buffer = cutMessage(buf);

      if (!msg) {
        const data: Buffer = await socketRead(conn);
        if (data.length === 0) {
          console.log("Connection ended by client");
          break;
        }
        bufPush(buf, data);
        continue;
      }

      // process the message and send the response
      if (msg.toString().trim() === "Quit") {
        await socketWrite(conn, Buffer.from("Bye.\n"));
        break;
      } else {
        const reply = Buffer.concat([Buffer.from("Echo: "), msg]);
        await socketWrite(conn, reply);
      }
    }
  } catch (error) {
    console.error("Error in serveClient: ", error);
  } finally {
    console.log("Closing connection for ", conn?.socket?.remoteAddress + ":" + conn?.socket?.remotePort);
    socket.end();
  }
}

async function newConnection(socket: net.Socket): Promise<void> {
  console.log(
    "New connection from ",
    socket.remoteAddress + ":" + socket.remotePort
  );

  await serveClient(socket);
}

const server = net.createServer({
  // required by `TCPConn`
  pauseOnConnect: true,
});

server.on("connection", (socket: net.Socket) => {
  // handle each new connection
  newConnection(socket).catch((err: Error) => {
    console.error("Error in new connection:", err);
  });
});

server.listen({ host: "127.0.0.1", port: 1234 }, () => {
  console.log("Server is listening on port 1234");
});
