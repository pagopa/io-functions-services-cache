import { Context } from "@azure/functions";
import { ServiceScopeEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/ServiceScope";
import {
  RetrievedService,
  ServiceModel,
  ValidService
} from "@pagopa/io-functions-commons/dist/src/models/service";
import { errorsToReadableMessages } from "@pagopa/ts-commons/lib/reporters";
import {
  NonEmptyString,
  OrganizationFiscalCode
} from "@pagopa/ts-commons/lib/strings";
import { enumType } from "@pagopa/ts-commons/lib/types";
import { fromEither } from "fp-ts/lib/TaskEither";
import * as t from "io-ts";

const ServiceExportCompact = t.interface({
  i: NonEmptyString,
  n: NonEmptyString,
  q: t.number
});
type ServiceExportCompact = t.TypeOf<typeof ServiceExportCompact>;

const ServiceExportExtended = t.intersection([
  t.interface({
    d: NonEmptyString,
    sc: enumType<ServiceScopeEnum>(ServiceScopeEnum, "ServiceScope")
  }),
  ServiceExportCompact
]);
type ServiceExportExtended = t.TypeOf<typeof ServiceExportExtended>;

export const ServiceExport = t.union([
  ServiceExportCompact,
  ServiceExportExtended
]);
export type ServiceExport = t.TypeOf<typeof ServiceExport>;

export const ServicesExportCompact = t.interface({
  fc: OrganizationFiscalCode,
  o: NonEmptyString,
  s: t.readonlyArray(ServiceExportCompact)
});
export type ServicesExportCompact = t.TypeOf<typeof ServicesExportCompact>;

export const ServicesExportExtended = t.interface({
  fc: OrganizationFiscalCode,
  o: NonEmptyString,
  s: t.readonlyArray(ServiceExportExtended)
});
export type ServicesExportExtended = t.TypeOf<typeof ServicesExportExtended>;

enum ExportModeEnum {
  EXTENDED = "EXTENDED",
  COMPACT = "COMPACT"
}

const ServicesOutputBindings = t.interface({
  visibleServicesCompact: t.record(
    OrganizationFiscalCode,
    ServicesExportCompact
  ),
  visibleServicesExtended: t.record(
    OrganizationFiscalCode,
    ServicesExportExtended
  )
});
type ServicesOutputBindings = t.TypeOf<typeof ServicesOutputBindings>;

const getServiceMapper = (
  mode: ExportModeEnum,
  serviceIdExclusionList: ReadonlyArray<NonEmptyString>
) => (service: RetrievedService): ServiceExport => {
  if (mode === ExportModeEnum.EXTENDED) {
    return {
      d: service.serviceMetadata?.description,
      i: service.serviceId,
      n: service.serviceName,
      q:
        serviceIdExclusionList.indexOf(service.serviceId) > -1
          ? 1
          : ValidService.decode(service).fold(
              _ => 0, // quality ko
              _ => 1 // quality ok
            ),
      sc: service.serviceMetadata?.scope || ServiceScopeEnum.NATIONAL
    };
  }
  return {
    i: service.serviceId,
    n: service.serviceName,
    q:
      serviceIdExclusionList.indexOf(service.serviceId) > -1
        ? 1
        : ValidService.decode(service).fold(
            _ => 0, // quality ko
            _ => 1 // quality ok
          )
  };
};

const groupServiceByOrganizationFiscalCode = (
  services: ReadonlyArray<RetrievedService>,
  serviceMapper: (service: RetrievedService) => ServiceExport
): Record<string, ServicesExportCompact | ServicesExportExtended> =>
  services.reduce((prev, _) => {
    if (prev[_.organizationFiscalCode]) {
      return {
        ...prev,
        [_.organizationFiscalCode]: {
          ...prev[_.organizationFiscalCode],
          s: [...prev[_.organizationFiscalCode].s, serviceMapper(_)]
        }
      };
    }
    return {
      ...prev,
      [_.organizationFiscalCode]: {
        fc: _.organizationFiscalCode,
        o: _.organizationName,
        s: [serviceMapper(_)]
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }, {} as Record<string, ServicesExportCompact | ServicesExportExtended>);

// eslint-disable-next-line @typescript-eslint/naming-convention
export const UpdateWebviewServicesMetadata = (
  serviceModel: ServiceModel,
  serviceIdExclusionList: ReadonlyArray<NonEmptyString>
) => async (context: Context): Promise<void> =>
  serviceModel
    .listLastVersionServices()
    .mapLeft(comsosError => new Error(`CosmosError: ${comsosError.kind}`))
    .map(maybeServices => {
      if (maybeServices.isNone()) {
        return [];
      }
      return maybeServices.value;
    })
    .map(services =>
      services
        .filter(service => service.isVisible)
        .reduce(
          (prev, service) => ({
            compact:
              service.serviceMetadata?.scope === ServiceScopeEnum.LOCAL
                ? [...prev.compact, service]
                : prev.compact,
            extended: [...prev.extended, service]
          }),
          {
            compact: [] as ReadonlyArray<RetrievedService>,
            extended: [] as ReadonlyArray<RetrievedService>
          }
        )
    )
    .chain(_ =>
      fromEither(
        ServicesOutputBindings.decode({
          visibleServicesCompact: groupServiceByOrganizationFiscalCode(
            _.compact,
            getServiceMapper(ExportModeEnum.COMPACT, serviceIdExclusionList)
          ),
          visibleServicesExtended: groupServiceByOrganizationFiscalCode(
            _.extended,
            getServiceMapper(ExportModeEnum.EXTENDED, serviceIdExclusionList)
          )
        }).mapLeft(err => new Error(errorsToReadableMessages(err).join("/")))
      )
    )
    .fold(
      error => {
        context.log.error(
          `UpdateWebviewServiceMetadata|ERROR|${error.message}`
        );
        throw new Error(
          "Error reading services from Cosmos or decoding output bindings"
        );
      },
      _ => {
        // eslint-disable-next-line functional/immutable-data
        context.bindings.visibleServicesCompact = _.visibleServicesCompact;
        // eslint-disable-next-line functional/immutable-data
        context.bindings.visibleServicesExtended = _.visibleServicesExtended;
      }
    )
    .run();
