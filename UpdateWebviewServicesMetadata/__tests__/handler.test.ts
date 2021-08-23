import { ServiceModel } from "@pagopa/io-functions-commons/dist/src/models/service";
import { taskEither } from "fp-ts/lib/TaskEither";
import { context } from "../../__mocks__/durable-functions";
import { aValidService } from "../../__mocks__/mocks";
import { ServicesExport, UpdateWebviewServicesMetadata } from "../handler";
import { some, none } from "fp-ts/lib/Option";
import { ServiceScopeEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/ServiceScope";
import { CosmosErrors } from "@pagopa/io-functions-commons/dist/src/utils/cosmosdb_model";
import { fromLeft } from "fp-ts/lib/TaskEither";

const mockListLastVersionServices = jest.fn();

const mockServiceModel = ({
  listLastVersionServices: mockListLastVersionServices
} as unknown) as ServiceModel;

describe("UpdateWebviewServicesMetadata", () => {
  it("should returns bindings for visible services", async () => {
    mockListLastVersionServices.mockImplementationOnce(() => {
      return taskEither.of(
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
      } as ServicesExport
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
      } as ServicesExport
    });
  });

  it("should returns services with quality equal to zero when services aren't complete", async () => {
    mockListLastVersionServices.mockImplementationOnce(() => {
      return taskEither.of(
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
      } as ServicesExport
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
      } as ServicesExport
    });
  });

  it("should return an empty object if no result was found in CosmosDB", async () => {
    mockListLastVersionServices.mockImplementationOnce(() => {
      return taskEither.of(none);
    });
    await UpdateWebviewServicesMetadata(mockServiceModel, [])(context);
    expect(context).toHaveProperty("bindings.visibleServicesCompact", {});
    expect(context).toHaveProperty("bindings.visibleServicesExtended", {});
  });

  it("should thrown a CosmosErrors", async () => {
    mockListLastVersionServices.mockImplementationOnce(() => {
      return fromLeft({} as CosmosErrors);
    });
    const result = UpdateWebviewServicesMetadata(mockServiceModel, [])(context);
    await expect(result).rejects.toThrowError(
      "Error reading or processing Services"
    );
  });
});
