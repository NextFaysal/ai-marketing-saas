import { Module } from "@nestjs/common";
import { OrganizationsController, PublicBrandingController } from "./organizations.controller";
import { InvitationsController } from "./invitations.controller";
import { OrganizationsService } from "./organizations.service";
@Module({ controllers: [OrganizationsController, InvitationsController, PublicBrandingController], providers: [OrganizationsService] })
export class OrganizationsModule {}
