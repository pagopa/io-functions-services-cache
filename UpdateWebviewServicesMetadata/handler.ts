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
import { pipe } from "fp-ts/lib/function";
import * as t from "io-ts";
import * as E from "fp-ts/lib/Either";
import * as TE from "fp-ts/lib/TaskEither";
import * as O from "fp-ts/lib/Option";
import * as T from "fp-ts/lib/Task";

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

/**
 * Create a service mapper helper to minimize the Service object size.
 * This object will be used to build the webview in IO Website.
 *
 */
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
          : pipe(
              ValidService.decode(service),
              E.fold(
                _ => 0, // quality ko
                _ => 1 // quality ok
              )
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
        : pipe(
            ValidService.decode(service),
            E.fold(
              _ => 0, // quality ko
              _ => 1 // quality ok
            )
          )
  };
};

/**
 * Group all services by Organization fiscal code and remap services
 * with a provided service mapper helper.
 *
 */
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
) => async (context: Context): Promise<unknown> =>
  pipe(
    serviceModel.listLastVersionServices(),
    TE.mapLeft(cosmosError => new Error(`CosmosError: ${cosmosError.kind}`)),
    TE.map(maybeServices => {
      if (O.isNone(maybeServices)) {
        return [];
      }
      return maybeServices.value;
    }),
    TE.map(services =>
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
    ),
    TE.chain(_ =>
      pipe(
        ServicesOutputBindings.decode({
          visibleServicesCompact: groupServiceByOrganizationFiscalCode(
            _.compact,
            getServiceMapper(ExportModeEnum.COMPACT, serviceIdExclusionList)
          ),
          visibleServicesExtended: groupServiceByOrganizationFiscalCode(
            _.extended,
            getServiceMapper(ExportModeEnum.EXTENDED, serviceIdExclusionList)
          )
        }),
        E.mapLeft(err => new Error(errorsToReadableMessages(err).join("/"))),
        TE.fromEither
      )
    ),
    TE.fold<Error, ServicesOutputBindings, undefined | never>(
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
        return T.of(void 0);
      }
    )
  )();
