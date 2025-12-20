import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useNavigate } from "react-router-dom";

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="fixed inset-0 flex items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">404 - Not Found</CardTitle>
          <CardDescription>
            The page you are looking for does not exist.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button onClick={() => navigate("/")} className="w-full">
            Go to Home
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
