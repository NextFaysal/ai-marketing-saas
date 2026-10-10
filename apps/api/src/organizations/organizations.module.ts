import { Module } from "@nestjs/common";
import { OrganizationsController } from "./organizations.controller";
import { InvitationsController } from "./invitations.controller";
import { OrganizationsService } from "./organizations.service";
@Module({ controllers: [OrganizationsController, InvitationsController], providers: [OrganizationsService] })
export class OrganizationsModule {}
