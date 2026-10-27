import test from "node:test";
import assert from "node:assert/strict";
import {
  getRequest,
  parseResponse,
  integer,
  oid,
  tlv,
  counterRate,
} from "../mobile/src/core/snmp.mjs";
const cat = (...p) => Uint8Array.from(p.flatMap((v) => [...v]));
const nameOid = "1.3.6.1.2.1.1.5.0";
const response = ({
  id = 123,
  version = 1,
  community = "public",
  error = 0,
  values = [[nameOid, tlv(4, Buffer.from("router-lab"))]],
} = {}) =>
  tlv(
    48,
    cat(
      integer(version),
      tlv(4, Buffer.from(community)),
      tlv(
        162,
        cat(
          integer(id),
          integer(error),
          integer(0),
          tlv(
            48,
            cat(...values.map(([key, value]) => tlv(48, cat(oid(key), value))))
          )
        )
      )
    )
  );
const expected = {
  requestId: 123,
  version: 1,
  community: "public",
  oids: [nameOid],
};
test("SNMP GetRequest matches an independently specified BER fixture", () => {
  const request = getRequest({
    requestId: 123,
    community: "public",
    oids: [nameOid],
  });
  assert.equal(
    Buffer.from(request).toString("hex"),
    "302602010104067075626c6963a01902017b020100020100300e300c06082b060102010105000500"
  );
});
test("GetResponse decodes text, unsigned counters, Timeticks, binary MAC and exceptions", () => {
  const values = [
    [nameOid, tlv(4, Buffer.from("Equipo ñ"))],
    ["1.3.6.1.2.1.1.3.0", tlv(67, [0, 128, 0, 0, 0])],
    ["1.3.6.1.2.1.2.2.1.10.1", tlv(65, [0xff, 0xff, 0xff, 0xff])],
    ["1.3.6.1.2.1.2.2.1.6.1", tlv(4, [0, 1, 2, 255, 128, 10])],
    ["2.999.128.65535", tlv(128, [])],
  ];
  const decoded = parseResponse(response({ values }), {
    ...expected,
    oids: values.map(([o]) => o),
  });
  assert.equal(decoded[nameOid].value, "Equipo ñ");
  assert.equal(decoded[values[1][0]].value, 2147483648);
  assert.equal(decoded[values[2][0]].value, 4294967295);
  assert.equal(decoded[values[3][0]].hex, "000102ff800a");
  assert.equal(decoded[values[4][0]].value, null);
});
test("long form BER length and v1 are supported", () => {
  const packet = response({
    version: 0,
    values: [[nameOid, tlv(4, Buffer.alloc(200, 65))]],
  });
  assert.equal(
    parseResponse(packet, { ...expected, version: 0 })[nameOid].value.length,
    200
  );
});
test("reject mismatched responses, SNMP errors, unexpected OIDs and trailing/truncated BER", () => {
  for (const options of [
    { id: 124 },
    { version: 0 },
    { community: "private" },
    { error: 2 },
    { values: [["1.3.6.1.2.1.1.3.0", integer(1)]] },
  ]) {
    assert.throws(() => parseResponse(response(options), expected));
  }
  const packet = response();
  for (let length = 0; length < packet.length; length++) {
    assert.throws(() => parseResponse(packet.slice(0, length), expected));
  }
  assert.throws(() => parseResponse(cat(packet, [0]), expected));
  assert.throws(() => parseResponse([48, 128, 0, 0], expected));
  assert.throws(() => oid("1.99.3"));
  assert.throws(() =>
    getRequest({ requestId: -1, community: "public", oids: [nameOid] })
  );
});
test("Counter32 rates handle one wrap and reject invalid intervals", () => {
  assert.equal(counterRate(100, 200, 1000), 800);
  assert.equal(counterRate(4294967290, 4, 1000), 80);
  assert.throws(() => counterRate(0, 1, 0));
});
