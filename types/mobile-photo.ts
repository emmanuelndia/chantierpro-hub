export type MobilePhotoSiteOption = {
  id: string;
  name: string;
  address: string;
  projectName: string;
  hasOpenSession: boolean;
};

export type MobilePhotoSitesResponse = {
  items: MobilePhotoSiteOption[];
};
