import { Navigate } from "react-router-dom";

/**
 * The partner travel desk is a desktop product for the club's own staff and is
 * deliberately kept out of the mobile apps. Native builds alias the portal to
 * this stub, so neither the desk nor the club's artwork is bundled into the
 * shipped binary; the route simply returns to the home screen.
 */
const McfcPortalNative = () => <Navigate to="/" replace />;

export default McfcPortalNative;
