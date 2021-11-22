import {
  RetrievedService,
  ServiceModel
} from "@pagopa/io-functions-commons/dist/src/models/service";
import { context } from "../../__mocks__/durable-functions";
import { aValidService } from "../../__mocks__/mocks";
import {
  ServicesExportCompact,
  ServicesExportExtended,
  UpdateWebviewServicesMetadata
} from "../handler";
import { ServiceScopeEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/ServiceScope";
import { CosmosErrors } from "@pagopa/io-functions-commons/dist/src/utils/cosmosdb_model";

import * as t from "io-ts";
import { NonNegativeInteger } from "@pagopa/ts-commons/lib/numbers";
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import { pipe } from "fp-ts/lib/function";
import * as RA from "fp-ts/ReadonlyArray";

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
