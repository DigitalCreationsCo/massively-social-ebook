import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md mx-2">
        <CardContent className="pt-3">
          <div className="flex mb-2 gap-2">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <h1 className="text-2xl font-bold text-gray-900">Page not found.</h1>
          </div>

          <p className="mt-2 text-sm text-gray-600">
            Did you make a wrong turn somewhere?
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
