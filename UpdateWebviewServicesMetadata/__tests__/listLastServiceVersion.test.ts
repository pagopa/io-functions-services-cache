import {
  RetrievedService,
  ServiceModel
} from "@pagopa/io-functions-commons/dist/src/models/service";
import { aValidService } from "../../__mocks__/mocks";
import { listLastVersionServices } from "../handler";
import { isSome } from "fp-ts/lib/Option";

import * as E from "fp-ts/Either";
import * as RA from "fp-ts/ReadonlyArray";
import { Container } from "@azure/cosmos";
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import { NonNegativeInteger } from "@pagopa/ts-commons/lib/numbers";

const aRetrievedService: RetrievedService = {
  ...aValidService,
  version: 1 as NonNegativeInteger,
  id: "1" as NonEmptyString,
  _rid: "rid",
  _etag: "etag",
  _self: "123",
  _ts: 123,
  kind: "IRetrievedService"
};

jest.setTimeout(5000 * 1000);

const mockFetchAll = jest.fn();
const mockGetAsyncIterator = jest.fn();
const mockCreate = jest.fn();
const containerMock = ({
  items: {
    readAll: jest.fn(() => ({
      fetchAll: mockFetchAll,
      getAsyncIterator: mockGetAsyncIterator
    })),
    create: mockCreate,
    query: jest.fn(() => ({
      fetchAll: mockFetchAll
    }))
  }
} as unknown) as Container;
const getAsyncIterable = <T>(pages: ReadonlyArray<ReadonlyArray<T>>) => ({
  [Symbol.asyncIterator]: async function* asyncGenerator() {
    let array = pages.map(_ => Promise.resolve(_));
    while (array.length) {
      yield { resources: await array.shift() };
    }
  }
});
function makeid(length: number) {
  var result = "";
  var characters = "0123456789";
  var charactersLength = characters.length;
  for (var i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}
const servicesId = new Set();
const orgs = new Set();
const maxServices = 5000;
const maxOrgs = 500;
for (let i = 0; i < maxServices; i++) {
  servicesId.add(makeid(11));
}
for (let k = 0; k < maxOrgs; k++) {
  orgs.add(makeid(11));
}
const organizations = Array.from(orgs);
const maxVersion = 10;
const instantData = Array.from(servicesId)
  .map((serviceId, _index) => {
    let values = [];
    const organizationFiscalCode =
      organizations[Math.floor(Math.random() * organizations.length)];
    for (let version = 0; version < maxVersion; version++) {
      const data = {
        ...aRetrievedService,
        serviceId,
        version,
        organizationFiscalCode
      } as RetrievedService;
      values.push(data);
    }
    return values;
  })
  .flat();
const asyncIterable = getAsyncIterable(RA.chunksOf(100)(instantData));

// -----------------------------------
// Execution time tests
// -----------------------------------
describe("listLastVersionServices", () => {
  it("old version execution time", async () => {
    mockGetAsyncIterator.mockReturnValueOnce(asyncIterable);
    const model1 = new ServiceModel(containerMock);

    const start = Date.now();
    const res = await model1.listLastVersionServices()();
    const end = Date.now();
    console.log("EXECUTION: ", end - start);

    expect(E.isRight(res)).toBeTruthy();
    if (E.isRight(res)) {
      expect(isSome(res.right)).toBeTruthy();
      if (isSome(res.right)) {
        console.log("ARRAY LENGHT: " + res.right.value.length);
      }
    }
  });

  it("new version execution time", async () => {
    mockGetAsyncIterator.mockReturnValueOnce(asyncIterable);
    const model1 = new ServiceModel(containerMock);

    var start = Date.now();
    const res = await listLastVersionServices(model1)();
    var end = Date.now();

    console.log("EXECUTION: ", end - start);

    expect(E.isRight(res)).toBeTruthy();
    if (E.isRight(res)) console.log("ARRAY LENGHT: " + res.right.length);
  });

  it("array equals", async () => {
    let resOldArray;

    mockGetAsyncIterator.mockReturnValueOnce(asyncIterable);
    const modelOld = new ServiceModel(containerMock);
    const res = await modelOld.listLastVersionServices()();
    if (E.isRight(res))
      if (isSome(res.right)) {
        resOldArray = res.right.value;
      }

    mockGetAsyncIterator.mockReturnValueOnce(asyncIterable);
    const model1 = new ServiceModel(containerMock);

    const resNew = await listLastVersionServices(model1)();

    if (E.isRight(resNew)) {
      const resNewArray = resNew.right;

      expect(resOldArray).toEqual(resNewArray);
      expect(resNewArray).toEqual(resOldArray);
    }
  });
});
