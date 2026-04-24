import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import EmailSkipAuditTable from "@/components/settings/EmailSkipAuditTable";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export default function EmailSkipAuditLog() {
  const navigate = useNavigate();
  const { userRole, loading } = useUserRole();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (userRole !== "admin") {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-16">
            <div className="flex flex-col items-center justify-center text-center">
              <ShieldAlert className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="text-xl font-semibold">Access Denied</h3>
              <p className="text-muted-foreground mt-2 max-w-md">
                Only administrators can view the email reply skip audit log.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/settings")} className="gap-1">
          <ArrowLeft className="h-4 w-4" /> Settings
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Email reply skip audit</h1>
          <p className="text-sm text-muted-foreground">Every reply rejected by the safety guards, with the reason it was blocked.</p>
        </div>
      </div>
      <EmailSkipAuditTable />
    </div>
  );
}
