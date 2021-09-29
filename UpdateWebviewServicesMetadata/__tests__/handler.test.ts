import { ServiceModel } from "@pagopa/io-functions-commons/dist/src/models/service";
import { context } from "../../__mocks__/durable-functions";
import { aValidService } from "../../__mocks__/mocks";
import {
  ServicesExportCompact,
  ServicesExportExtended,
  UpdateWebviewServicesMetadata
} from "../handler";
import { some, none } from "fp-ts/lib/Option";
import { ServiceScopeEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/ServiceScope";
import { CosmosErrors } from "@pagopa/io-functions-commons/dist/src/utils/cosmosdb_model";
import * as TE from "fp-ts/lib/TaskEither";

const mockListLastVersionServices = jest.fn();

const mockServiceModel = ({
  listLastVersionServices: mockListLastVersionServices
} as unknown) as ServiceModel;

describe("UpdateWebviewServicesMetadata", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    context.bindings = {};
  });

  it("should returns bindings for visible services", async () => {
    mockListLastVersionServices.mockImplementationOnce(() => {
      return TE.of(
        some([
          aValidService,
          {
            ...aValidService,
            serviceMetadata: {
              ...aValidService.serviceMetadata,
              scope: ServiceScopeEnum.LOCAL
            }
          }
        ])
      );
    });

    await UpdateWebviewServicesMetadata(mockServiceModel, [])(context);

    expect(context).toHaveProperty("bindings.visibleServicesCompact", {
      [aValidService.organizationFiscalCode]: {
        fc: aValidService.organizationFiscalCode,
        o: aValidService.organizationName,
        s: [
          {
            i: aValidService.serviceId,
            n: aValidService.serviceName,
            q: 1
          }
        ]
      } as ServicesExportCompact
    });
    expect(context).toHaveProperty("bindings.visibleServicesExtended", {
      [aValidService.organizationFiscalCode]: {
        fc: aValidService.organizationFiscalCode,
        o: aValidService.organizationName,
        s: [
          {
            i: aValidService.serviceId,
            n: aValidService.serviceName,
            d: aValidService.serviceMetadata.description,
            sc: aValidService.serviceMetadata.scope,
            q: 1
          },
          {
            i: aValidService.serviceId,
            n: aValidService.serviceName,
            d: aValidService.serviceMetadata.description,
            sc: ServiceScopeEnum.LOCAL,
            q: 1
          }
        ]
      } as ServicesExportExtended
    });
  });

  it("should returns services with quality equal to zero when services aren't complete", async () => {
    mockListLastVersionServices.mockImplementationOnce(() => {
      return TE.of(
        some([
          {
            ...aValidService,
            serviceMetadata: {
              ...aValidService.serviceMetadata,
              scope: ServiceScopeEnum.LOCAL,
              privacyUrl: undefined
            }
          }
        ])
      );
    });

    await UpdateWebviewServicesMetadata(mockServiceModel, [])(context);

    expect(context).toHaveProperty("bindings.visibleServicesCompact", {
      [aValidService.organizationFiscalCode]: {
        fc: aValidService.organizationFiscalCode,
        o: aValidService.organizationName,
        s: [
          {
            i: aValidService.serviceId,
            n: aValidService.serviceName,
            q: 0
          }
        ]
      } as ServicesExportCompact
    });
    expect(context).toHaveProperty("bindings.visibleServicesExtended", {
      [aValidService.organizationFiscalCode]: {
        fc: aValidService.organizationFiscalCode,
        o: aValidService.organizationName,
        s: [
          {
            i: aValidService.serviceId,
            n: aValidService.serviceName,
            d: aValidService.serviceMetadata.description,
            sc: ServiceScopeEnum.LOCAL,
            q: 0
          }
        ]
      } as ServicesExportExtended
    });
  });

  it("should return an empty object if no result was found in CosmosDB", async () => {
    mockListLastVersionServices.mockImplementationOnce(() => {
      return TE.of(none);
    });
    await UpdateWebviewServicesMetadata(mockServiceModel, [])(context);
    expect(context).toHaveProperty("bindings.visibleServicesCompact", {});
    expect(context).toHaveProperty("bindings.visibleServicesExtended", {});
  });

  it("should thrown a CosmosErrors", async () => {
    const expectedCosmosError = {
      kind: "COSMOS_ERROR_RESPONSE"
    } as CosmosErrors;
    mockListLastVersionServices.mockImplementationOnce(() => {
      return TE.left(expectedCosmosError);
    });
    const result = UpdateWebviewServicesMetadata(mockServiceModel, [])(context);
    await expect(result).rejects.toThrowError(
      "Error reading services from Cosmos or decoding output bindings"
    );
    expect(context.log.error).toBeCalledWith(
      expect.stringContaining(
        `UpdateWebviewServiceMetadata|ERROR|${expectedCosmosError.kind}`
      )
    );
    expect(context).not.toHaveProperty("bindings.visibleServicesCompact");
    expect(context).not.toHaveProperty("bindings.visibleServicesExtended");
  });

  it("should return an error if the bindings decoding fails", async () => {
    mockListLastVersionServices.mockImplementationOnce(() => {
      return TE.of(
        some([
          {
            ...aValidService,
            serviceMetadata: {
              ...aValidService.serviceMetadata,
              scope: ServiceScopeEnum.LOCAL,
              description: "" // Empty string description
            }
          }
        ])
      );
    });
    const result = UpdateWebviewServicesMetadata(mockServiceModel, [])(context);
    await expect(result).rejects.toThrowError(
      "Error reading services from Cosmos or decoding output bindings"
    );
    expect(context.log.error).toBeCalledWith(expect.any(String));
    expect(context).not.toHaveProperty("bindings.visibleServicesCompact");
    expect(context).not.toHaveProperty("bindings.visibleServicesExtended");
  });

  it("should success if some service has undefined description", async () => {
    mockListLastVersionServices.mockImplementationOnce(() => {
      return TE.of(
        some([
          {
            ...aValidService,
            serviceMetadata: {
              ...aValidService.serviceMetadata,
              scope: ServiceScopeEnum.LOCAL,
              description: undefined
            }
          }
        ])
      );
    });
    const result = await UpdateWebviewServicesMetadata(
      mockServiceModel,
      []
    )(context);
    expect(context).toHaveProperty("bindings.visibleServicesCompact");
    expect(context).toHaveProperty("bindings.visibleServicesExtended");
  });
});
