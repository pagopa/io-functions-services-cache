import {
  RetrievedService,
  ServiceModel
} from "@pagopa/io-functions-commons/dist/src/models/service";
import { context } from "../../__mocks__/durable-functions";
import { aValidService } from "../../__mocks__/mocks";
import {
  listLastVersionServices,
  ServicesExportCompact,
  ServicesExportExtended,
  UpdateWebviewServicesMetadata
} from "../handler";
import { isSome } from "fp-ts/lib/Option";
import { ServiceScopeEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/ServiceScope";
import { CosmosErrors } from "@pagopa/io-functions-commons/dist/src/utils/cosmosdb_model";

import * as t from "io-ts";

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

const aServiceNational = aRetrievedService;
const aServiceLocal = {
  ...aRetrievedService,
  serviceId: "anotherId" as NonEmptyString,
  serviceMetadata: {
    ...aValidService.serviceMetadata,
    scope: ServiceScopeEnum.LOCAL
  }
};

/**
 * Build a service list iterator
 */
async function* buildServiceIterator(
  list: ReadonlyArray<unknown>,
  errorToThrow?: CosmosErrors
): AsyncGenerator<
  ReadonlyArray<t.Validation<RetrievedService>>,
  void,
  unknown
> {
  // eslint-disable-next-line functional/no-let

  if (errorToThrow) {
    throw errorToThrow;
  }

  for (const p of pipe(list, RA.map(RetrievedService.decode), RA.chunksOf(2))) {
    yield p;
  }
}

// ----------------------
// Mocks
// ----------------------
const mockCollectionIterator = jest.fn(() =>
  buildServiceIterator([])[Symbol.asyncIterator]()
);

const mockServiceModel = ({
  getCollectionIterator: mockCollectionIterator
} as unknown) as ServiceModel;

// ----------
//  TESTS
// ----------
describe("UpdateWebviewServicesMetadata", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    context.bindings = {};
  });

  it("should returns bindings for visible services", async () => {
    mockCollectionIterator.mockImplementationOnce(() =>
      buildServiceIterator([aServiceNational, aServiceLocal])[
        Symbol.asyncIterator
      ]()
    );

    await UpdateWebviewServicesMetadata(mockServiceModel, [])(context);

    expect(context).toHaveProperty("bindings.visibleServicesCompact", [
      {
        fc: aServiceLocal.organizationFiscalCode,
        o: aServiceLocal.organizationName,
        s: [
          {
            i: aServiceLocal.serviceId,
            n: aServiceLocal.serviceName,
            q: 1
          }
        ]
      } as ServicesExportCompact
    ]);
    expect(context).toHaveProperty("bindings.visibleServicesExtended", [
      {
        fc: aServiceNational.organizationFiscalCode,
        o: aServiceNational.organizationName,
        s: [
          {
            i: aServiceNational.serviceId,
            n: aServiceNational.serviceName,
            d: aServiceNational.serviceMetadata!.description,
            sc: aServiceNational.serviceMetadata!.scope,
            q: 1
          },
          {
            i: aServiceLocal.serviceId,
            n: aServiceLocal.serviceName,
            d: aServiceLocal.serviceMetadata!.description,
            sc: ServiceScopeEnum.LOCAL,
            q: 1
          }
        ]
      } as ServicesExportExtended
    ]);
  });

  it("should returns services with quality equal to zero when services aren't complete", async () => {
    mockCollectionIterator.mockImplementationOnce(() =>
      buildServiceIterator([
        {
          ...aServiceLocal,
          serviceMetadata: {
            ...aServiceLocal.serviceMetadata,
            privacyUrl: undefined
          }
        }
      ])[Symbol.asyncIterator]()
    );

    await UpdateWebviewServicesMetadata(mockServiceModel, [])(context);

    expect(context).toHaveProperty("bindings.visibleServicesCompact", [
      {
        fc: aServiceLocal.organizationFiscalCode,
        o: aServiceLocal.organizationName,
        s: [
          {
            i: aServiceLocal.serviceId,
            n: aServiceLocal.serviceName,
            q: 0
          }
        ]
      } as ServicesExportCompact
    ]);
    expect(context).toHaveProperty("bindings.visibleServicesExtended", [
      {
        fc: aServiceLocal.organizationFiscalCode,
        o: aServiceLocal.organizationName,
        s: [
          {
            i: aServiceLocal.serviceId,
            n: aServiceLocal.serviceName,
            d: aServiceLocal.serviceMetadata.description,
            sc: ServiceScopeEnum.LOCAL,
            q: 0
          }
        ]
      } as ServicesExportExtended
    ]);
  });

  it("should return an empty array if no result was found in CosmosDB", async () => {
    mockCollectionIterator.mockImplementationOnce(() =>
      buildServiceIterator([])[Symbol.asyncIterator]()
    );

    await UpdateWebviewServicesMetadata(mockServiceModel, [])(context);
    expect(context).toHaveProperty("bindings.visibleServicesCompact", []);
    expect(context).toHaveProperty("bindings.visibleServicesExtended", []);
  });

  it("should thrown a CosmosErrors", async () => {
    const expectedCosmosError = {
      kind: "COSMOS_ERROR_RESPONSE"
    } as CosmosErrors;

    mockCollectionIterator.mockImplementationOnce(() =>
      buildServiceIterator([], expectedCosmosError)[Symbol.asyncIterator]()
    );

    const result = UpdateWebviewServicesMetadata(mockServiceModel, [])(context);
    await expect(result).rejects.toThrowError(
      "Error reading services from Cosmos or decoding output bindings"
    );
    expect(context.log.error).toBeCalledWith(
      expect.stringContaining(
        `UpdateWebviewServiceMetadata|ERROR|Error retrieving data from cosmos.`
      )
    );
    expect(context).not.toHaveProperty("bindings.visibleServicesCompact");
    expect(context).not.toHaveProperty("bindings.visibleServicesExtended");
  });

  it("should return an error if the bindings decoding fails", async () => {
    mockCollectionIterator.mockImplementationOnce(() =>
      buildServiceIterator([
        {
          ...aServiceLocal,
          serviceMetadata: {
            ...aServiceLocal.serviceMetadata,
            description: "" // Empty string description
          }
        }
      ])[Symbol.asyncIterator]()
    );

    const result = UpdateWebviewServicesMetadata(mockServiceModel, [])(context);
    await expect(result).rejects.toThrowError(
      "Error reading services from Cosmos or decoding output bindings"
    );
    expect(context.log.error).toBeCalledWith(expect.any(String));
    expect(context).not.toHaveProperty("bindings.visibleServicesCompact");
    expect(context).not.toHaveProperty("bindings.visibleServicesExtended");
  });
});

it("should success if some service has undefined description", async () => {
  mockCollectionIterator.mockImplementationOnce(() =>
    buildServiceIterator([
      {
        ...aServiceLocal,
        serviceMetadata: {
          ...aServiceLocal.serviceMetadata,
          description: undefined
        }
      }
    ])[Symbol.asyncIterator]()
  );

  const result = await UpdateWebviewServicesMetadata(
    mockServiceModel,
    []
  )(context);
  expect(context).toHaveProperty("bindings.visibleServicesCompact");
  expect(context).toHaveProperty("bindings.visibleServicesExtended");
});

// -----------------------------------
// Execution time tests
// -----------------------------------

jest.setTimeout(5000 * 1000);

import { pipe } from "fp-ts/lib/function";
import * as E from "fp-ts/Either";
import * as RA from "fp-ts/ReadonlyArray";
import { Container } from "@azure/cosmos";
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import { NonNegativeInteger } from "@pagopa/ts-commons/lib/numbers";

// -------
// -------

describe("listLastVersionServices", () => {
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

  // -------------
  // -------------
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
