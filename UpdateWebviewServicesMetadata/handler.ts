import { Context } from "@azure/functions";
import { ServiceScopeEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/ServiceScope";
import {
  RetrievedService,
  ServiceModel,
  ValidService
} from "@pagopa/io-functions-commons/dist/src/models/service";
import {
  NonEmptyString,
  OrganizationFiscalCode
} from "@pagopa/ts-commons/lib/strings";
import { enumType } from "@pagopa/ts-commons/lib/types";
import * as t from "io-ts";

const ServiceExportR = t.interface({
  i: NonEmptyString,
  n: NonEmptyString
});
type ServiceExportR = t.TypeOf<typeof ServiceExportR>;

const ServiceExportO = t.partial({
  d: NonEmptyString,
  q: t.number,
  sc: enumType<ServiceScopeEnum>(ServiceScopeEnum, "ServiceScope")
});
type ServiceExportO = t.TypeOf<typeof ServiceExportO>;

export const ServiceExport = t.intersection([ServiceExportR, ServiceExportO]);
export type ServiceExport = t.TypeOf<typeof ServiceExport>;

export const ServicesExport = t.interface({
  fc: OrganizationFiscalCode,
  o: NonEmptyString,
  s: t.readonlyArray(ServiceExport)
});

export type ServicesExport = t.TypeOf<typeof ServicesExport>;

enum ExportModeEnum {
  EXTENDED = "EXTENDED",
  COMPACT = "COMPACT"
}

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
): Record<string, ServicesExport> =>
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
  }, {} as Record<string, ServicesExport>);

// eslint-disable-next-line @typescript-eslint/naming-convention
export const UpdateWebviewServicesMetadata = (
  serviceModel: ServiceModel,
  serviceIdExclusionList: ReadonlyArray<NonEmptyString>
) => async (context: Context): Promise<void> =>
  serviceModel
    .listLastVersionServices()
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
    .map(_ => ({
      compact: groupServiceByOrganizationFiscalCode(
        _.compact,
        getServiceMapper(ExportModeEnum.COMPACT, serviceIdExclusionList)
      ),
      extended: groupServiceByOrganizationFiscalCode(
        _.extended,
        getServiceMapper(ExportModeEnum.EXTENDED, serviceIdExclusionList)
      )
    }))
    .fold(
      _ => {
        throw new Error("Error reading or processing Services");
      },
      _ => {
        // eslint-disable-next-line functional/immutable-data
        context.bindings.visibleServicesCompact = _.compact;
        // eslint-disable-next-line functional/immutable-data
        context.bindings.visibleServicesExtended = _.extended;
      }
    )
    .run();
