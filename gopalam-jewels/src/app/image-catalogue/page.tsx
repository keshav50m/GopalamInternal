import Link from "next/link";
import ImageCatalogueUpload from "@/components/imageCatalogue/ImageCatalogueUpload";
import styles from "@/components/imageCatalogue/ImageCatalogue.module.css";
import MissingImagesPanel from "@/components/imageCatalogue/MissingImagesPanel";

export default function ImageCataloguePage() {
  return (
    <main className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.topBarInner}>
          <div className={styles.brandBlock}>
            <span>Gopalam Jewels</span>
            <h1>Image Catalogue</h1>
          </div>

          <nav className={styles.navLinks} aria-label="Primary navigation">
            <Link className={styles.navLink} href="/">
              Scanner
            </Link>
            <Link className={styles.navLink} href="/dashboard">
              Dashboard
            </Link>
            <Link className={styles.activeNavLink} href="/image-catalogue">
              Image Catalogue
            </Link>
            <Link className={styles.navLink} href="/custom-search">
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
