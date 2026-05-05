import { PhotosHubPage } from '@/components/photos-hub-page';
import { getRequiredWebSession } from '@/lib/auth/web-session';

export default async function WebPhotosPage() {
  const session = await getRequiredWebSession();

  return (
    <PhotosHubPage
      viewer={{
        id: session.id,
        role: session.role,
      }}
    />
  );
}
