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

// parsed HTTP request header
type HTTPReq = {
  method: string;
  uri: Buffer;
  version: string;
  headers: Buffer[];
};

// HTTP response
type HTTPRes = {
  code: number;
  headers: Buffer[];
  body: BodyReader;
};

// interface for reading/writing data from/to HTTP body
type BodyReader = {
  // "Content-Length", -1 if unknown.
  length: number;

  // read data. returns an empty buffer after EOF.
  read: () => Promise<Buffer>;
};

class HTTPError extends Error {
  code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.name = "HTTPError";
  }
}

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

function splitLines(data: Buffer): Buffer[] {
  const lines: Buffer[] = [];

  let start = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0x0d && data[i + 1] === 0x0a) {
      // '\r\n'
      lines.push(data.slice(start, i));

      start = i + 2;
      i++; // skip the '\n'
    }
  }

  // Add the final line if it doesn't end with '\r\n'
  if (start < data.length) {
    lines.push(data.slice(start));
  }

  return lines;
}

function parseRequestLine(line: Buffer): [string, Buffer, string] {
  const parts = line.toString().split(" ");

  if (parts.length !== 3) {
    throw new HTTPError(400, "Malformed request line");
  }

  const method = parts[0];
  const uri = Buffer.from(parts[1]);
  const version = parts[2];

  // Validate HTTP method
  const validMethods = [
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "HEAD",
    "OPTIONS",
    "PATCH",
    "CONNECT",
    "TRACE",
  ];
  if (!validMethods.includes(method)) {
    throw new HTTPError(400, "Invalid HTTP method");
  }

  return [method, uri, version];
}

function validateHeader(header: Buffer): boolean {
  const colonIndex = header.indexOf(":");

  if (colonIndex === -1) {
    return false;
  }

  const name = header.slice(0, colonIndex).toString().trim();
  const value = header
    .slice(colonIndex + 1)
    .toString()
    .trim();

  // Ensure header name and value are not empty
  if (!name || !value) {
    return false;
  }

  // Validate header name: RFC 7230 section 3.2
  const token = /^[!#$%&'*+\-.^_`|~0-9a-zA-Z]+$/;
  if (!token.test(name)) {
    return false;
  }

  return true;
}

// parse an HTTP request header
function parseHTTPReq(data: Buffer): HTTPReq {
  // split the data into lines
  const lines: Buffer[] = splitLines(data);

  // the first line is `METHOD URI VERSION`
  const [method, uri, version] = parseRequestLine(lines[0]);

  // followed by header fields in the format of `Name: value`
  const headers: Buffer[] = [];
  for (let i = 1; i < lines.length - 1; i++) {
    // copy
    const h = Buffer.from(lines[i]);

    if (!validateHeader(h)) {
      throw new HTTPError(400, "bad field");
    }

    headers.push(h);
  }

  // the header ends by an empty line
  console.assert(lines[lines.length - 1].length === 0);

  return {
    method: method,
    uri: uri,
    version: version,
    headers: headers,
  };
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

// parse & remove a header from beginning of the buffer if possible
function cutMessage(buf: DynBuf): null | HTTPReq {
  // the maximum length of an HTTP header
  const kMaxHeaderLen = 1024 * 8;

  // the end of the header is marked by '\r\n\r\n'
  const idx = buf.data.subarray(0, buf.length).indexOf("\r\n\r\n");

  if (idx < 0) {
    if (buf.length >= kMaxHeaderLen) {
      throw new HTTPError(413, "header is too large");
    }

    // need more data
    return null;
  }

  // parse & remove the header
  const msg = parseHTTPReq(buf.data.subarray(0, idx + 4));
  bufPop(buf, idx + 4);

  return msg;
}

function fieldGet(headers: Buffer[], key: string): null | Buffer {
  // Convert the key to lowercase for case-insensitive comparison
  const lowerKey = key.toLowerCase();

  for (const header of headers) {
    const index = header.indexOf(":");
    if (index !== -1) {
      const fieldName = header.slice(0, index).toString().trim().toLowerCase();
      const fieldValue = header
        .slice(index + 1)
        .toString()
        .trim();

      if (fieldName === lowerKey) {
        return Buffer.from(fieldValue);
      }
    }
  }

  return null;
}

function parseDec(input: string): number {
  return parseInt(input, 10);
}

// BodyReader from a socket with a known length
function readerFromConnLength(
  conn: TCPConn,
  buf: DynBuf,
  remain: number
): BodyReader {
  return {
    length: remain,
    read: async (): Promise<Buffer> => {
      if (remain === 0) {
        return Buffer.from(""); // done
      }

      if (buf.length === 0) {
        // try to get some data if there is none
        const data = await socketRead(conn);
        bufPush(buf, data);

        if (data.length === 0) {
          // expect more data!
          throw new Error("Unexpected EOF from HTTP body");
        }
      }

      // consume data from the buffer
      const consume = Math.min(buf.length, remain);
      remain -= consume;

      const data = Buffer.from(buf.data.subarray(0, consume));
      bufPop(buf, consume);

      return data;
    },
  };
}

// BodyReader from an HTTP request
function readerFromReq(conn: TCPConn, buf: DynBuf, req: HTTPReq): BodyReader {
  let bodyLen = -1;
  const contentLen = fieldGet(req.headers, "Content-Length");

  if (contentLen) {
    bodyLen = parseDec(contentLen.toString("latin1"));
    if (isNaN(bodyLen)) {
      throw new HTTPError(400, "bad Content-Length.");
    }
  }

  const bodyAllowed = !(req.method === "GET" || req.method === "HEAD");
  const chunked =
    fieldGet(req.headers, "Transfer-Encoding")?.equals(
      Buffer.from("chunked")
    ) || false;
  if (!bodyAllowed && (bodyLen > 0 || chunked)) {
    throw new HTTPError(400, "HTTP body not allowed.");
  }

  if (!bodyAllowed) {
    bodyLen = 0;
  }

  if (bodyLen >= 0) {
    // "Content-Length" is present
    return readerFromConnLength(conn, buf, bodyLen);
  } else if (chunked) {
    // chunked encoding
    throw new HTTPError(501, "TODO");
  } else {
    // read the rest of the connection
    throw new HTTPError(501, "TODO");
  }
}

// BodyReader from in-memory data
function readerFromMemory(data: Buffer): BodyReader {
  let done = false;
  return {
    length: data.length,
    read: async (): Promise<Buffer> => {
      if (done) {
        return Buffer.from(""); // no more data
      } else {
        done = true;
        return data;
      }
    },
  };
}

// a sample request handler
async function handleReq(req: HTTPReq, body: BodyReader): Promise<HTTPRes> {
  // act on the request URI
  let resp: BodyReader;
  switch (req.uri.toString("latin1")) {
    case "/echo":
      // http echo server
      resp = body;
      break;
    default:
      resp = readerFromMemory(Buffer.from("hello world.\n"));
      break;
  }

  return {
    code: 200,
    headers: [Buffer.from("Server: my_first_http_server")],
    body: resp,
  };
}

// Utility function to get the reason phrase for a status code
function getReasonPhrase(statusCode: number): string {
  const reasonPhrases: { [code: number]: string } = {
    200: "OK",
    201: "Created",
    204: "No Content",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    500: "Internal Server Error",
    501: "Not Implemented",
    502: "Bad Gateway",
    503: "Service Unavailable",
  };

  return reasonPhrases[statusCode] || "Unknown Status";
}

function encodeHTTPResp(resp: HTTPRes): Buffer {
  // HTTP version
  const version = "HTTP/1.1";

  // Status code and reason phrase
  const reasonPhrase = getReasonPhrase(resp.code);
  const statusLine = `${version} ${resp.code} ${reasonPhrase}\r\n`;

  // Headers
  const headers = resp.headers
    .map((header) => header.toString("latin1") + "\r\n")
    .join("");

  // Combine status line, headers, and the end of headers marker
  const responseString = statusLine + headers + "\r\n";

  // Convert the complete response string to a Buffer
  return Buffer.from(responseString, "latin1");
}

// send an HTTP response through the socket
async function writeHTTPResp(conn: TCPConn, resp: HTTPRes): Promise<void> {
  if (resp.body.length < 0) {
    throw new Error("TODO: chunked encoding");
  }

  // set the "Content-Length" field
  console.assert(!fieldGet(resp.headers, "Content-Length"));

  resp.headers.push(Buffer.from(`Content-Length: ${resp.body.length}`));

  // write the header
  await socketWrite(conn, encodeHTTPResp(resp));

  // write the body
  while (true) {
    const data = await resp.body.read();
    if (data.length === 0) {
      break;
    }

    await socketWrite(conn, data);
  }
}

async function serveClient(conn: TCPConn): Promise<void> {
  const buf: DynBuf = { data: Buffer.alloc(0), length: 0 };

  while (true) {
    // try to get 1 request header from the buffer
    const msg: null | HTTPReq = cutMessage(buf);

    if (!msg) {
      // need more data
      const data: Buffer = await socketRead(conn);
      bufPush(buf, data);

      // EOF?
      if (data.length === 0 && buf.length === 0) {
        return; // no more requests
      }

      if (data.length === 0) {
        throw new HTTPError(400, "Unexpected EOF.");
      }

      // got some data, try it again.
      continue;
    }

    // process the message and send the response
    const reqBody: BodyReader = readerFromReq(conn, buf, msg);

    const res: HTTPRes = await handleReq(msg, reqBody);

    await writeHTTPResp(conn, res);

    // close the connection for HTTP/1.0
    if (msg.version === "1.0") {
      return;
    }

    // make sure that the request body is consumed completely
    while ((await reqBody.read()).length > 0) {
      /* empty */
    }
  }
}

async function newConnection(socket: net.Socket): Promise<void> {
  console.log(
    "New connection from ",
    socket.remoteAddress + ":" + socket.remotePort
  );

  const conn: TCPConn = socketInit(socket);

  try {
    await serveClient(conn);
  } catch (excp) {
    console.error("exception:", excp);

    if (excp instanceof HTTPError) {
      const resp: HTTPRes = {
        code: excp.code,
        headers: [],
        body: readerFromMemory(Buffer.from(excp.message + "\n")),
      };

      try {
        await writeHTTPResp(conn, resp);
      } catch (excp) {
        /* ignore */
      }
    }
  } finally {
    socket.destroy();
  }
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
