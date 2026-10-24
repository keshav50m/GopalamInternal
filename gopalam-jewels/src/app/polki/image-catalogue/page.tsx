import Link from "next/link";
import ImageCatalogueUpload from "@/components/polki/imageCatalogue/ImageCatalogueUpload";
import styles from "@/components/polki/imageCatalogue/ImageCatalogue.module.css";
import MissingImagesPanel from "@/components/polki/imageCatalogue/MissingImagesPanel";
import AdminButton from "@/components/AdminButton";
import ChangeTypeButton from "@/components/ChangeTypeButton";

export default function ImageCataloguePage() {
  return (
    <main className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.topBarInner}>
          <div className={styles.brandArea}>
            <ChangeTypeButton />
            <div className={styles.brandBlock}>
              <span>Gopalam Jewels</span>
              <h1>Image Catalogue</h1>
            </div>
          </div>
          <AdminButton />

          <nav className={styles.navLinks} aria-label="Primary navigation">
            <Link className={styles.navLink} href="/polki/scanner">
              Scanner
            </Link>
            <Link className={styles.navLink} href="/polki/dashboard">
              Dashboard
            </Link>
            <Link className={styles.activeNavLink} href="/polki/image-catalogue">
              Image Catalogue
            </Link>
            <Link className={styles.navLink} href="/polki/custom-search">
              Custom Search
            </Link>
            
          </nav>
        </div>
      </header>

      <div className={styles.content}>
        <ImageCatalogueUpload />
        <MissingImagesPanel />
      </div>
    </main>
  );
}
