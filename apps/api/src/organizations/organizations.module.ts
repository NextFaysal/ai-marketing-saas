import { Module } from "@nestjs/common";
import { OrganizationsController, PublicBrandingController } from "./organizations.controller";
import { InvitationsController } from "./invitations.controller";
import { OrganizationsService } from "./organizations.service";
import { StorageModule } from "../storage/storage.module";
@Module({ imports: [StorageModule], controllers: [OrganizationsController, InvitationsController, PublicBrandingController], providers: [OrganizationsService] })
export class OrganizationsModule {}
