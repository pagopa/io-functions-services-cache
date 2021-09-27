import { AzureFunction } from "@azure/functions";
import {
  ServiceModel,
  SERVICE_COLLECTION_NAME
} from "@pagopa/io-functions-commons/dist/src/models/service";
import { getConfigOrThrow } from "../utils/config";
import { cosmosdbClient } from "../utils/cosmosdb";
import { UpdateWebviewServicesMetadata } from "./handler";

const config = getConfigOrThrow();

const servicesContainer = cosmosdbClient
  .database(config.COSMOSDB_NAME)
  .container(SERVICE_COLLECTION_NAME);

const serviceModel = new ServiceModel(servicesContainer);

const index: AzureFunction = UpdateWebviewServicesMetadata(
  serviceModel,
  config.SERVICEID_EXCLUSION_LIST
);

export default index;
