import { CIDR } from "@pagopa/io-functions-commons/dist/generated/definitions/CIDR";
import { ServiceScopeEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/ServiceScope";
import { ValidService } from "@pagopa/io-functions-commons/dist/src/models/service";
import { WithinRangeInteger } from "@pagopa/ts-commons/lib/numbers";
import {
  FiscalCode,
  NonEmptyString,
  OrganizationFiscalCode
} from "@pagopa/ts-commons/lib/strings";

export const aFiscalCode = "AAABBB01C02D345D" as FiscalCode;
export const anotherFiscalCode = "AAABBB01C02D345W" as FiscalCode;

export const aValidService: ValidService = {
  authorizedCIDRs: new Set((["0.0.0.0"] as unknown) as CIDR[]),
  authorizedRecipients: new Set([aFiscalCode, anotherFiscalCode]),
  departmentName: "department" as NonEmptyString,
  isVisible: true,
  maxAllowedPaymentAmount: (0 as unknown) as number &
    WithinRangeInteger<0, 9999999999>,
  organizationFiscalCode: "01234567890" as OrganizationFiscalCode,
  organizationName: "Organization" as NonEmptyString,
  requireSecureChannels: true,
  serviceId: "01234567890" as NonEmptyString,
  serviceName: "Service" as NonEmptyString,
  serviceMetadata: {
    description: "Service Description" as NonEmptyString,
    privacyUrl: "https://example.com/privacy.html" as NonEmptyString,
    supportUrl: "https://example.com/support.html" as NonEmptyString,
    scope: ServiceScopeEnum.NATIONAL
  }
};
