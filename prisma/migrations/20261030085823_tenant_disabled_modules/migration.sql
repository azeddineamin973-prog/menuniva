-- AlterTable
ALTER TABLE "RestaurantOrganization" ADD COLUMN     "disabledModules" TEXT[] DEFAULT ARRAY[]::TEXT[];
