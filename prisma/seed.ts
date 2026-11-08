// Seeds starter categories, Addis Ababa sub-cities and default settings.
// Safe to run more than once: it only creates what is missing and never overwrites
// categories or areas that an admin has already edited.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

type Field = {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  options?: string[];
  required?: boolean;
};
type Leaf = { name: string; slug: string; fields?: Field[] };
type Group = { name: string; slug: string; children: Leaf[] };

const vehicleFields: Field[] = [
  { key: "make", label: "Make", type: "text", required: true },
  { key: "model", label: "Model", type: "text", required: true },
  { key: "year", label: "Year", type: "number", required: true },
  { key: "mileage_km", label: "Mileage (km)", type: "number" },
];
const carFields: Field[] = [
  ...vehicleFields,
  { key: "fuel", label: "Fuel", type: "select", options: ["Petrol", "Diesel", "Electric", "Hybrid"] },
  { key: "transmission", label: "Transmission", type: "select", options: ["Manual", "Automatic"] },
];
const propertyFields: Field[] = [
  { key: "bedrooms", label: "Bedrooms", type: "number" },
  { key: "size_sqm", label: "Size (m²)", type: "number" },
];
const landFields: Field[] = [{ key: "size_sqm", label: "Size (m²)", type: "number", required: true }];
const phoneFields: Field[] = [
  { key: "brand", label: "Brand", type: "text", required: true },
  { key: "model", label: "Model", type: "text" },
  { key: "storage_gb", label: "Storage", type: "select", options: ["16 GB", "32 GB", "64 GB", "128 GB", "256 GB", "512 GB", "1 TB"] },
];
const computerFields: Field[] = [
  { key: "brand", label: "Brand", type: "text", required: true },
  { key: "model", label: "Model", type: "text" },
];

const groups: Group[] = [
  {
    name: "Vehicles",
    slug: "vehicles",
    children: [
      { name: "Cars", slug: "cars", fields: carFields },
      { name: "Motorcycles", slug: "motorcycles", fields: vehicleFields },
      { name: "Trucks and buses", slug: "trucks-and-buses", fields: vehicleFields },
      { name: "Vehicle parts", slug: "vehicle-parts" },
    ],
  },
  {
    name: "Real estate",
    slug: "real-estate",
    children: [
      { name: "Houses for sale", slug: "houses-for-sale", fields: propertyFields },
      { name: "Apartments for sale", slug: "apartments-for-sale", fields: propertyFields },
      { name: "Houses for rent", slug: "houses-for-rent", fields: propertyFields },
      { name: "Apartments for rent", slug: "apartments-for-rent", fields: propertyFields },
      { name: "Land and plots", slug: "land-and-plots", fields: landFields },
      { name: "Commercial property", slug: "commercial-property", fields: [{ key: "size_sqm", label: "Size (m²)", type: "number" }] },
    ],
  },
  {
    name: "Phones and electronics",
    slug: "phones-and-electronics",
    children: [
      { name: "Mobile phones", slug: "mobile-phones", fields: phoneFields },
      { name: "Laptops and computers", slug: "laptops-and-computers", fields: computerFields },
      { name: "TVs and audio", slug: "tvs-and-audio" },
      { name: "Cameras", slug: "cameras" },
      { name: "Accessories", slug: "electronics-accessories" },
    ],
  },
  {
    name: "Home and furniture",
    slug: "home-and-furniture",
    children: [
      { name: "Furniture", slug: "furniture" },
      { name: "Appliances", slug: "appliances" },
      { name: "Kitchen and dining", slug: "kitchen-and-dining" },
      { name: "Garden and decor", slug: "garden-and-decor" },
    ],
  },
  {
    name: "Services",
    slug: "services",
    children: [
      { name: "Home services", slug: "home-services" },
      { name: "Repairs", slug: "repairs" },
      { name: "Education and tutoring", slug: "education-and-tutoring" },
      { name: "Events", slug: "events" },
      { name: "Other services", slug: "other-services" },
    ],
  },
];

// Addis Ababa's sub-cities. Please verify this list. Neighborhoods are left for an admin to add.
const subCities = [
  "Addis Ketema",
  "Akaky Kaliti",
  "Arada",
  "Bole",
  "Gullele",
  "Kirkos",
  "Kolfe Keranio",
  "Lemi Kura",
  "Lideta",
  "Nifas Silk-Lafto",
  "Yeka",
];

async function main() {
  const prisma = new PrismaClient();

  let order = 0;
  for (const group of groups) {
    order += 1;
    const parent =
      (await prisma.category.findUnique({ where: { slug: group.slug } })) ??
      (await prisma.category.create({ data: { name: group.name, slug: group.slug, order } }));

    let childOrder = 0;
    for (const child of group.children) {
      childOrder += 1;
      const exists = await prisma.category.findUnique({ where: { slug: child.slug } });
      if (!exists) {
        await prisma.category.create({
          data: {
            name: child.name,
            slug: child.slug,
            order: childOrder,
            parentId: parent.id,
            fields: child.fields ?? [],
          },
        });
      }
    }
  }
  if (!(await prisma.category.findUnique({ where: { slug: "other" } }))) {
    await prisma.category.create({ data: { name: "Other", slug: "other", order: 99 } });
  }

  for (const name of subCities) {
    const exists = await prisma.area.findFirst({ where: { name, parentId: null } });
    if (!exists) await prisma.area.create({ data: { name } });
  }

  await prisma.setting.upsert({
    where: { key: "app" },
    update: {},
    create: { key: "app", value: { listingExpiryDays: 30, maxPhotosPerListing: 8, maxPhotoMegabytes: 5 } },
  });

  await prisma.$disconnect();
  console.log("Seed complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
