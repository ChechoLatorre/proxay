import brotli from "brotli";
import fs from "fs-extra";
import yaml from "js-yaml";
import path from "path";
import { gunzipSync, gzipSync } from "zlib";
import {
  CompressionAlgorithm,
  Headers,
  PersistedBuffer,
  PersistedTapeRecord,
  TapeRecord,
} from "./tape";

/**
 * Persistence layer to save tapes to disk and read them from disk.
 */
export class Persistence {
  constructor(
    private readonly tapeDir: string,
    private readonly redactHeaders: string[]
  ) {}

  /**
   * Saves the tape to disk.
   */
  saveTapeToDisk(tapeName: string, tapeRecords: TapeRecord[]) {
    const persistedTapeRecords = tapeRecords
      .map(this.redact, this)
      .map(persistTape);
    const tapePath = this.getTapePath(tapeName);
    fs.ensureDirSync(path.dirname(tapePath));
    fs.writeFileSync(
      tapePath,
      yaml.safeDump({
        http_interactions: persistedTapeRecords,
      }),
      "utf8"
    );
  }

  /**
   * Redacts the request headers of the given record, depending on the redactHeaders array
   */
  private redact(record: TapeRecord): TapeRecord {
    redactRequestHeaders(record, this.redactHeaders);
    return record;
  }

  /**
   * Loads the tape from disk.
   */
  loadTapeFromDisk(tapeName: string): TapeRecord[] {
    const tapePath = this.getTapePath(tapeName);
    if (!fs.existsSync(tapePath)) {
      throw new Error(`No tape found with name ${tapeName}`);
    }
    const persistedTapeRecords = yaml.safeLoad(
      fs.readFileSync(tapePath, "utf8")
    ).http_interactions as PersistedTapeRecord[];
    return persistedTapeRecords.map(reviveTape);
  }

  isTapeNameValid(tapeName: string): boolean {
    return !path
      .relative(this.tapeDir, path.join(this.tapeDir, tapeName))
      .startsWith("../");
  }

  /**
   * Returns the tape's path on disk.
   */
  private getTapePath(tapeName: string) {
    return path.join(this.tapeDir, `${tapeName}.yml`);
  }
}

/**
 * Redacts the headers of the given record based on the provided array of headers to redact
 */
export function redactRequestHeaders(
  record: TapeRecord,
  redactHeaders: string[]
) {
  redactHeaders.forEach((header) => {
    if (record.request.headers[header]) {
      record.request.headers[header] = "XXXX";
    }
  });
}

export function persistTape(record: TapeRecord): PersistedTapeRecord {
  return {
    request: {
      method: record.request.method,
      path: record.request.path,
      headers: record.request.headers,
      body: serialiseBuffer(record.request.body, record.request.headers),
    },
    response: {
      status: record.response.status,
      headers: record.response.headers,
      body: serialiseBuffer(record.response.body, record.response.headers),
    },
  };
}

export function reviveTape(persistedRecord: PersistedTapeRecord): TapeRecord {
  return {
    request: {
      method: persistedRecord.request.method,
      path: persistedRecord.request.path,
      headers: persistedRecord.request.headers,
      body: unserialiseBuffer(persistedRecord.request.body),
    },
    response: {
      status: persistedRecord.response.status,
      headers: persistedRecord.response.headers,
      body: unserialiseBuffer(persistedRecord.response.body),
    },
  };
}

export function serialiseBuffer(
  buffer: Buffer,
  headers: Headers
): PersistedBuffer {
  const header = headers["content-encoding"];
  const contentEncoding = typeof header === "string" ? header : undefined;
  const originalBuffer = buffer;
  let compression: CompressionAlgorithm = "none";
  if (contentEncoding === "br") {
    buffer = Buffer.from(brotli.decompress(buffer));
    compression = "br";
  }
  if (contentEncoding === "gzip") {
    buffer = gunzipSync(buffer);
    compression = "gzip";
  }
  const utf8Representation = buffer.toString("utf8");
  try {
    // Can it be safely stored and recreated in YAML?
    const recreatedBuffer = Buffer.from(
      yaml.safeLoad(yaml.safeDump(utf8Representation)),
      "utf8"
    );
    if (Buffer.compare(buffer, recreatedBuffer) === 0) {
      // Yes, we can store it in YAML.
      return {
        encoding: "utf8",
        data: utf8Representation,
        compression,
      };
    }
  } catch {
    // Fall through.
  }
  // No luck. Fall back to Base64, persisting the original buffer
  // since we might as well store it in its compressed state.
  return {
    encoding: "base64",
    data: originalBuffer.toString("base64"),
  };
}

function unserialiseBuffer(persisted: PersistedBuffer): Buffer {
  let buffer;
  switch (persisted.encoding) {
    case "base64":
      buffer = Buffer.from(persisted.data, "base64");
      break;
    case "utf8":
      buffer = Buffer.from(persisted.data, "utf8");
      if (persisted.compression === "br") {
        // TODO: Find a workaround for the new compressed message not necessarily
        // being identical to what was originally sent (update Content-Length?).
        const compressed = brotli.compress(buffer);
        if (compressed) {
          buffer = Buffer.from(compressed);
        } else {
          throw new Error(`Brotli compression failed!`);
        }
      }
      if (persisted.compression === "gzip") {
        // TODO: Find a workaround for the new compressed message not necessarily
        // being identical to what was originally sent (update Content-Length?).
        buffer = gzipSync(buffer);
      }
      break;
    default:
      throw new Error(`Unsupported encoding!`);
  }
  return buffer;
}


export function storeDataMap(
  data: { [key: string]: string; },
  path: string,
){
  const jsonContent = JSON.stringify(data)
  fs.writeFile(path, jsonContent, 'utf8', function (err) {
    if (err) {
        console.log("An error occured while writing JSON Object to File.");
        return console.log(err);
    }
    console.log("JSON file has been saved.");
  });
}

export function loadDataMap(
  path: string,
): { [key: string]: string; } {
  let mapRecord: { [key: string]: string; } = {};
  try {
    fs.statSync(path)
  } catch (error) {
    fs.writeFileSync(path, '{}');
  }
  mapRecord = fs.readJsonSync(path)
  return mapRecord

}