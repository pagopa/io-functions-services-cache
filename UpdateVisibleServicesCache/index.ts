/**
 * This time triggered function creates a cache for visible services:
 *
 * - read the cached visible-service.json (input binding)
 * - create a version of services/visible-services.json suitable to be consumed by the mobile APP
 * - put the generated JSON into the assets storage (which is reachable behind the CDN)
 * - loop on visible services and store services/<serviceid>.json (output binding)
 *
 * The tuple stored is (serviceId, version, scope).
 *
 * TODO: delete blobs for services that aren't visible anymore.
 */
import { Context } from "@azure/functions";

import { isLeft, toError } from "fp-ts/lib/Either";
import { StrMap } from "fp-ts/lib/StrMap";
import { VisibleService } from "@pagopa/io-functions-commons/dist/src/models/visible_service";

import * as df from "durable-functions";
import * as t from "io-ts";
import { NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import { NonNegativeInteger } from "@pagopa/ts-commons/lib/numbers";
import { ServiceScope } from "@pagopa/io-functions-commons/dist/generated/definitions/ServiceScope";
import { array } from "fp-ts/lib/Array";
import { taskEither, tryCatch } from "fp-ts/lib/TaskEither";
import { getConfigOrThrow } from "../utils/config";

// eslint-disable-next-line @typescript-eslint/naming-convention
export const VisibleServices = t.record(t.string, VisibleService);
export type VisibleServices = t.TypeOf<typeof VisibleServices>;
// eslint-disable-next-line @typescript-eslint/naming-convention
export const VisibleServiceCache = t.intersection([
  t.interface({
    // eslint-disable-next-line @typescript-eslint/naming-convention
    service_id: NonEmptyString,
    version: NonNegativeInteger
  }),
  t.partial({
    scope: ServiceScope
  })
]);
export type VisibleServiceCache = t.TypeOf<typeof VisibleServiceCache>;

// eslint-disable-next-line @typescript-eslint/naming-convention
const UpdateVisibleServiceCache = async (context: Context): Promise<void> => {
  const errorOrVisibleServices = VisibleServices.decode(
    context.bindings.visibleServicesBlob
  );

  if (isLeft(errorOrVisibleServices)) {
    context.log.info(
      "UpdateVisibleServiceCache|Cannot decode visible services"
    );
    return;
  }

  const visibleServiceJson = errorOrVisibleServices.value;
  const visibleServices = new StrMap(visibleServiceJson);

  const visibleServicesTuples = visibleServices.mapWithKey((_, v) => ({
    scope: v.serviceMetadata ? v.serviceMetadata.scope : undefined,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    service_id: v.serviceId,
    version: v.version
  }));

  // store visible services in the blob
  // eslint-disable-next-line functional/immutable-data
  context.bindings.visibleServicesCacheBlob = {
    items: visibleServicesTuples.reduce(
      [] as ReadonlyArray<VisibleServiceCache>,
      (p, c) => [...p, c]
    )
  };

  const { left: NATIONAL, right: LOCAL } = visibleServices.partition(
    s => s.serviceMetadata !== undefined && s.serviceMetadata.scope === "LOCAL"
  );

  // store visible services partitioned by scope
  // eslint-disable-next-line functional/immutable-data
  context.bindings.visibleServicesByScopeCacheBlob = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    LOCAL: LOCAL.map(_ => _.serviceId).reduce(
      [] as ReadonlyArray<NonEmptyString>,
      (p, c) => [...p, c]
    ),
    // eslint-disable-next-line @typescript-eslint/naming-convention
    NATIONAL: NATIONAL.map(_ => _.serviceId).reduce(
      [] as ReadonlyArray<NonEmptyString>,
      (p, c) => [...p, c]
    )
  };

  // start orchestrator to loop on every visible service
  // and to store it in a blob
  const splittedVisibleServices = Object.values(visibleServiceJson).reduce(
    (acc: ReadonlyArray<VisibleServices>, service, index) => {
      if (
        index &&
        index % getConfigOrThrow().MaxServicesOrchestratorSize === 0
      ) {
        return [
          ...acc,
          {
            [service.serviceId]: service
          }
        ];
      }
      return [
        ...acc.slice(0, -1),
        {
          ...acc[acc.length - 1],
          [service.serviceId]: service
        }
      ];
    },
    [{}] as ReadonlyArray<VisibleServices>
  );
  await array
    .sequence(taskEither)(
      splittedVisibleServices.map(_ =>
        tryCatch(
          () =>
            df
              .getClient(context)
              .startNew("UpdateVisibleServicesCacheOrchestrator", undefined, _),
          toError
        )
      )
    )
    .mapLeft(_ => {
      context.log.error(
        `UpdateVisibleServiceCache|ERROR|An error occurred starting the orchestrators ${_}`
      );
    })
    .run();
};

export { UpdateVisibleServiceCache as index };
